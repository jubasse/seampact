<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\Delivery;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\EnumTypeUse;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\Refinements;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\TypeUse;
use Seampact\Ir\Model\UnknownKeysPolicy;
use Seampact\Laravel\Runtime\InputTree;

/**
 * The validation rules of one operation (ADR 0023 "Types and validation"), as PHP source per rule key: `bail`, then
 * `nullable` on a nullable member, the generated type rule, which also checks that a required member is there (never
 * Laravel's `required`, which fails on `""`, nor `present`, which fails under an absent optional parent or a parent of
 * another type), then the value rules. Under `rules: native` a value rule is Laravel's own where it has one, numbers behind
 * `numeric:strict`, and a string with a length or a pattern also gets the generated rule for blank strings, which
 * Laravel's rules skip. Unknown keys, enums and formats Laravel lacks are generated rules in both modes.
 */
final class MemberRules
{
    private const PATTERN_DELIMITERS = ['/', '#', '~', '%', '!', '@', ';', ','];
    private const NATIVE_PATTERN_MODIFIERS = 'u';
    private const CONSISTENT_PATTERN_MODIFIERS = 'uD';

    /** @var array<string, list<string>> each rule key and its rules as PHP expressions */
    public array $rules = [];

    /** @var array<string, array<string, string>> each rule key, Laravel's name of a native rule on it, and its contract rule */
    public array $nativeNames = [];

    /** @var array<string, true> the schemas on the way to the current member */
    private array $visiting = [];

    public function __construct(
        private readonly PhpLayout $layout,
        private readonly RulesMode $mode,
        private readonly PhpClassFile $file,
        private readonly Refusals $refusals,
    ) {
    }

    public function param(string $part, Param $param, IrPlace $at): void
    {
        $this->member($part . '.' . InputTree::escape($param->name), $param->type, $param->required ? 'Required' : 'Optional', false, 'Member', $at->below('type'));
    }

    public function body(TypeUse $schema, IrPlace $at): void
    {
        $this->member('body', $schema, 'Required', false, 'Member', $at);
    }

    /**
     * @param 'Required'|'Optional' $presence
     * @param 'Member'|'Item' $position
     */
    private function member(string $key, TypeUse $type, string $presence, bool $nullable, string $position, IrPlace $at): void
    {
        $nullable = $nullable || match (true) {
            $type instanceof ScalarTypeUse, $type instanceof EnumTypeUse, $type instanceof RefTypeUse, $type instanceof ArrayTypeUse => $type->nullable === true,
            default => false,
        };

        $rules = ["'bail'"];
        if ($nullable) {
            $rules[] = "'nullable'";
        }

        $rules[] = $this->construct('TypeRule', [
            '$input',
            $this->runtimeName('Position') . "::{$position}",
            $this->runtimeName('TypeRule') . '::' . $this->jsonTypeOf($type),
            $this->runtimeName('Presence') . "::{$presence}",
            $this->runtimeName('Nullability') . '::' . ($nullable ? 'Nullable' : 'NotNull'),
        ]);
        $this->rules[$key] = $rules;

        match (true) {
            $type instanceof ScalarTypeUse => $this->scalar($key, $type, $position, $at),
            $type instanceof EnumTypeUse => $this->enum($key, $type, $position),
            $type instanceof RefTypeUse => $this->object($key, $type, $position, $at),
            $type instanceof ArrayTypeUse => $this->list($key, $type, $position, $at),
            default => throw new \LogicException("The {$type->tag()} type use was kept but has no rule."),
        };
    }

    private function jsonTypeOf(TypeUse $type): string
    {
        if ($type instanceof ScalarTypeUse) {
            return match ($type->type->value) {
                ScalarType::Integer => 'INTEGER',
                ScalarType::Number => 'NUMBER',
                ScalarType::Boolean => 'BOOLEAN',
                default => 'STRING',
            };
        }

        return match (true) {
            $type instanceof RefTypeUse => 'OBJECT',
            $type instanceof ArrayTypeUse => 'ARRAY',
            default => 'STRING',
        };
    }

    /** @param 'Member'|'Item' $position */
    private function scalar(string $key, ScalarTypeUse $type, string $position, IrPlace $at): void
    {
        $refinements = $type->refinements;
        $native = $this->mode === RulesMode::Native;

        if ($type->format === KeptForms::FORMAT_UUID && $native) {
            $this->addNative($key, "'uuid'", 'Uuid', 'format');
        } elseif ($type->format !== null) {
            $formatConstant = $type->format === KeptForms::FORMAT_UUID ? 'UUID' : 'DATE_TIME';
            $this->rules[$key][] = $this->construct('FormatRule', ['$input', $this->runtimeName('Position') . "::{$position}", $this->runtimeName('FormatRule') . "::{$formatConstant}"]);
        }

        if (in_array($type->type->value, [ScalarType::Integer, ScalarType::Number], true)) {
            $this->number($key, $refinements, $position);
        } elseif ($type->type->value === ScalarType::String) {
            $this->string($key, $refinements, $position, $at);
        }
    }

    /** @param 'Member'|'Item' $position */
    private function number(string $key, Refinements $refinements, string $position): void
    {
        $bounds = [
            'minimum' => [$refinements->minimum, 'gte', 'Gte'],
            'maximum' => [$refinements->maximum, 'lte', 'Lte'],
            'exclusiveMinimum' => [$refinements->exclusiveMinimum, 'gt', 'Gt'],
            'exclusiveMaximum' => [$refinements->exclusiveMaximum, 'lt', 'Lt'],
            'multipleOf' => [$refinements->multipleOf, 'multiple_of', 'MultipleOf'],
        ];
        $declared = array_filter($bounds, static fn (array $bound): bool => $bound[0] !== null);

        if ($declared === []) {
            return;
        }

        if ($this->mode === RulesMode::SeampactConsistent) {
            $arguments = ['$input', $this->runtimeName('Position') . "::{$position}"];
            foreach ($declared as $contractRule => [$value]) {
                $arguments[] = "{$contractRule}: " . self::numberLiteral((string) $value);
            }
            $this->rules[$key][] = $this->construct('NumberRule', $arguments);

            return;
        }

        $this->addNative($key, "'numeric:strict'", 'Numeric', 'type');
        foreach ($declared as $contractRule => [$value, $laravelRule, $laravelName]) {
            $this->addNative($key, var_export("{$laravelRule}:{$value}", true), $laravelName, $contractRule);
        }
    }

    /** @param 'Member'|'Item' $position */
    private function string(string $key, Refinements $refinements, string $position, IrPlace $at): void
    {
        if ($refinements->minLength === null && $refinements->maxLength === null && $refinements->pattern === null) {
            return;
        }

        $native = $this->mode === RulesMode::Native;
        $pattern = null;
        if ($refinements->pattern !== null) {
            $pattern = self::pcre($refinements->pattern->normalized, $native ? self::NATIVE_PATTERN_MODIFIERS : self::CONSISTENT_PATTERN_MODIFIERS);
            if ($pattern === null) {
                $this->refusals->waiting('pattern.delimiter', 'A pattern holding every PCRE delimiter the target uses (' . implode(' ', self::PATTERN_DELIMITERS) . ')', $at->below('refinements', 'pattern'), Delivery::Consumer);
            }
        }

        if ($native) {
            if ($refinements->minLength !== null) {
                $this->addNative($key, "'min:{$refinements->minLength}'", 'Min', 'minLength');
            }
            if ($refinements->maxLength !== null) {
                $this->addNative($key, "'max:{$refinements->maxLength}'", 'Max', 'maxLength');
            }
            if ($pattern !== null) {
                $this->addNative($key, var_export("regex:{$pattern}", true), 'Regex', 'pattern');
            }
        }

        $arguments = ['$input', $this->runtimeName('Position') . "::{$position}", $this->runtimeName('BlankStrings') . '::' . ($native ? 'BlankOnly' : 'Every')];
        if ($refinements->minLength !== null) {
            $arguments[] = "minLength: {$refinements->minLength}";
        }
        if ($refinements->maxLength !== null) {
            $arguments[] = "maxLength: {$refinements->maxLength}";
        }
        if ($pattern !== null) {
            $arguments[] = 'pattern: ' . var_export($pattern, true);
        }
        $this->rules[$key][] = $this->construct('StringRule', $arguments);
    }

    /** @param 'Member'|'Item' $position */
    private function enum(string $key, EnumTypeUse $type, string $position): void
    {
        $values = $type->narrowedTo->values ?? $this->layout->ir->enums[$type->enum]->values ?? [];
        $listed = '[' . implode(', ', array_map(static fn (string $value): string => var_export($value, true), $values)) . ']';

        $this->rules[$key][] = $this->construct('EnumRule', ['$input', $this->runtimeName('Position') . "::{$position}", $listed]);
    }

    /** @param 'Member'|'Item' $position */
    private function object(string $key, RefTypeUse $type, string $position, IrPlace $at): void
    {
        $schema = $this->layout->ir->schemas[$type->schema] ?? null;
        if (!$schema instanceof ObjectSchema) {
            return;
        }

        if (isset($this->visiting[$type->schema])) {
            $this->refusals->waiting('schema.recursive', "The schema '{$type->schema}', which holds itself, in a request", IrPlace::root()->below('schemas', $type->schema), Delivery::AfterOneZero);

            return;
        }

        if (($type->unknownKeys?->policy->value ?? UnknownKeysPolicy::Refuse) === UnknownKeysPolicy::Refuse) {
            $declared = '[' . implode(', ', array_map(static fn ($property): string => var_export($property->name, true), $schema->properties)) . ']';
            $this->rules[$key][] = $this->construct('UnknownKeysRule', ['$input', $this->runtimeName('Position') . "::{$position}", $declared]);
        }

        $this->visiting[$type->schema] = true;
        foreach ($schema->properties as $index => $property) {
            $this->member(
                $key . '.' . InputTree::escape($property->name),
                $property->type,
                $property->optional ? 'Optional' : 'Required',
                $property->nullable,
                'Member',
                IrPlace::root()->below('schemas', $type->schema, 'properties', $index, 'type'),
            );
        }
        unset($this->visiting[$type->schema]);
    }

    /** @param 'Member'|'Item' $position */
    private function list(string $key, ArrayTypeUse $type, string $position, IrPlace $at): void
    {
        if ($type->minItems !== null || $type->maxItems !== null) {
            if ($this->mode === RulesMode::Native) {
                if ($type->minItems !== null) {
                    $this->addNative($key, "'min:{$type->minItems}'", 'Min', 'minItems');
                }
                if ($type->maxItems !== null) {
                    $this->addNative($key, "'max:{$type->maxItems}'", 'Max', 'maxItems');
                }
            } else {
                $arguments = ['$input', $this->runtimeName('Position') . "::{$position}"];
                if ($type->minItems !== null) {
                    $arguments[] = "minItems: {$type->minItems}";
                }
                if ($type->maxItems !== null) {
                    $arguments[] = "maxItems: {$type->maxItems}";
                }
                $this->rules[$key][] = $this->construct('ItemCountRule', $arguments);
            }
        }

        $this->member("{$key}.*", $type->items, 'Required', false, 'Item', $at->below('items'));
    }

    private function addNative(string $key, string $rule, string $laravelName, string $contractRule): void
    {
        $this->rules[$key][] = $rule;
        $this->nativeNames[$key][$laravelName] = $contractRule;
    }

    /** @param list<string> $arguments */
    private function construct(string $runtimeClass, array $arguments): string
    {
        return 'new ' . $this->runtimeName($runtimeClass) . '(' . implode(', ', $arguments) . ')';
    }

    private function runtimeName(string $simpleName): string
    {
        return $this->file->name($this->layout->runtime($simpleName));
    }

    /** The PCRE form of a normalised pattern, between the first delimiter it does not hold; null when it holds all. */
    private static function pcre(string $normalized, string $modifiers): ?string
    {
        foreach (self::PATTERN_DELIMITERS as $delimiter) {
            if (!str_contains($normalized, $delimiter)) {
                return $delimiter . $normalized . $delimiter . $modifiers;
            }
        }

        return null;
    }

    private static function numberLiteral(string $decimal): string
    {
        return preg_match('/^-?(0|[1-9]\d{0,17})$/D', $decimal) === 1 || str_contains($decimal, '.') || stripos($decimal, 'e') !== false
            ? $decimal
            : $decimal . '.0';
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\Delivery;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
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
use Seampact\Laravel\Runtime\BlankStrings;
use Seampact\Laravel\Runtime\InputTree;
use Seampact\Laravel\Runtime\Nullability;
use Seampact\Laravel\Runtime\Position;
use Seampact\Laravel\Runtime\Presence;

/**
 * The validation rules of one operation (ADR 0023 "Types and validation"), as PHP source per rule key: `bail`, then
 * `nullable` on a nullable member, the generated type rule, which also checks that a required member is there (never
 * Laravel's `required`, which fails on `""`, nor `present`, which fails under an absent optional parent or a parent of
 * another type), then the value rules. Under `rules: native` a value rule is Laravel's own where it has one, numbers behind
 * `numeric:strict`, and a `uuid` string or one with a length or a pattern also gets the generated rule for blank
 * strings, which Laravel's rules skip. Unknown keys, of an object and of the query under `unknownQuery: refuse`, enums
 * and formats Laravel lacks are generated rules in both modes.
 */
final class MemberRules
{
    private const PATTERN_DELIMITERS = ['/', '#', '~', '%', '!', '@', ';', ','];
    private const NATIVE_PATTERN_MODIFIERS = 'u';
    private const CONSISTENT_PATTERN_MODIFIERS = 'uD';

    private const QUERY_PART = 'query';

    /** @var array<string, list<string>> each rule key and its rules as PHP expressions */
    private array $rules = [];

    /** @var array<string, array<string, string>> each rule key, Laravel's name of a native rule on it, and its contract rule */
    private array $nativeNames = [];

    /** @var array<string, true> the schemas on the way to the current member */
    private array $visiting = [];

    public function __construct(
        private readonly PhpLayout $layout,
        private readonly RulesMode $mode,
        private readonly PhpClassFile $file,
        private readonly Refusals $refusals,
    ) {
    }

    /** @return array<string, list<string>> each rule key and its rules as PHP expressions */
    public function rules(): array
    {
        return $this->rules;
    }

    /** @return array<string, array<string, string>> each rule key, Laravel's name of a native rule on it, and its contract rule */
    public function nativeNames(): array
    {
        return $this->nativeNames;
    }

    public function param(string $part, Param $param, IrPlace $at): void
    {
        $presence = $param->required ? Presence::Required : Presence::Optional;
        $this->member($part . '.' . InputTree::escape($param->name), $param->type, $presence, Nullability::NotNull, Position::Member, $at->below('type'));
    }

    /**
     * Refuses every query key the operation does not declare (`unknownQuery: refuse`).
     *
     * @param list<Param> $declared
     */
    public function refuseUnknownQuery(array $declared): void
    {
        $names = array_map(static fn (Param $param): string => $param->name, $declared);
        $this->rules[self::QUERY_PART] = [$this->construct('UnknownKeysRule', ['$input', $this->position(Position::Member), self::stringList($names)])];
    }

    public function body(TypeUse $schema, IrPlace $at): void
    {
        $this->member('body', $schema, Presence::Required, Nullability::NotNull, Position::Member, $at);
    }

    private function member(string $key, TypeUse $type, Presence $presence, Nullability $declared, Position $position, IrPlace $at): void
    {
        $nullable = $declared === Nullability::Nullable || match (true) {
            $type instanceof ScalarTypeUse, $type instanceof EnumTypeUse, $type instanceof RefTypeUse, $type instanceof ArrayTypeUse => $type->nullable === true,
            default => false,
        };

        $rules = ["'bail'"];
        if ($nullable) {
            $rules[] = "'nullable'";
        }

        $rules[] = $this->construct('TypeRule', [
            '$input',
            $this->position($position),
            $this->runtimeName('TypeRule') . '::' . $this->jsonTypeOf($type),
            $this->runtimeName('Presence') . '::' . $presence->name,
            $this->runtimeName('Nullability') . '::' . ($nullable ? Nullability::Nullable : Nullability::NotNull)->name,
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

    private function scalar(string $key, ScalarTypeUse $type, Position $position, IrPlace $at): void
    {
        $refinements = $type->refinements;
        $nativeUuid = $type->format === KeptForms::FORMAT_UUID && $this->mode === RulesMode::Native;

        if ($nativeUuid) {
            $this->addNative($key, "'uuid'", 'Uuid', 'format');
        }

        if ($type->format !== null) {
            $formatConstant = $type->format === KeptForms::FORMAT_UUID ? 'UUID' : 'DATE_TIME';
            $this->rules[$key][] = $this->construct('FormatRule', [
                '$input',
                $this->position($position),
                $this->runtimeName('FormatRule') . "::{$formatConstant}",
                $this->blankStrings($nativeUuid ? BlankStrings::BlankOnly : BlankStrings::Every),
            ]);
        }

        if ($refinements->multipleOf !== null && ($type->type->value !== ScalarType::Integer || preg_match('/^-?\d+$/D', (string) $refinements->multipleOf) !== 1)) {
            $this->refusals->inconsistent('multipleOf.notInteger', "A 'multipleOf' of {$refinements->multipleOf} on a '{$type->type->value}' value, which ADR 0003 keeps on integers only", $at->below('refinements', 'multipleOf'));
        }

        if (in_array($type->type->value, [ScalarType::Integer, ScalarType::Number], true)) {
            $this->number($key, $refinements, $position);
        } elseif ($type->type->value === ScalarType::String) {
            $this->string($key, $refinements, $position, $at);
        }
    }

    private function number(string $key, Refinements $refinements, Position $position): void
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
            $arguments = ['$input', $this->position($position)];
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

    private function string(string $key, Refinements $refinements, Position $position, IrPlace $at): void
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

        $arguments = ['$input', $this->position($position), $this->blankStrings($native ? BlankStrings::BlankOnly : BlankStrings::Every)];
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

    private function enum(string $key, EnumTypeUse $type, Position $position): void
    {
        $values = $type->narrowedTo->values ?? $this->layout->ir->enums[$type->enum]->values ?? [];

        $this->rules[$key][] = $this->construct('EnumRule', ['$input', $this->position($position), self::stringList($values)]);
    }

    private function object(string $key, RefTypeUse $type, Position $position, IrPlace $at): void
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
            $declared = array_map(static fn ($property): string => $property->name, $schema->properties);
            $this->rules[$key][] = $this->construct('UnknownKeysRule', ['$input', $this->position($position), self::stringList($declared)]);
        }

        $this->visiting[$type->schema] = true;
        foreach ($schema->properties as $index => $property) {
            $this->member(
                $key . '.' . InputTree::escape($property->name),
                $property->type,
                $property->optional ? Presence::Optional : Presence::Required,
                $property->nullable ? Nullability::Nullable : Nullability::NotNull,
                Position::Member,
                IrPlace::root()->below('schemas', $type->schema, 'properties', $index, 'type'),
            );
        }
        unset($this->visiting[$type->schema]);
    }

    private function list(string $key, ArrayTypeUse $type, Position $position, IrPlace $at): void
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
                $arguments = ['$input', $this->position($position)];
                if ($type->minItems !== null) {
                    $arguments[] = "minItems: {$type->minItems}";
                }
                if ($type->maxItems !== null) {
                    $arguments[] = "maxItems: {$type->maxItems}";
                }
                $this->rules[$key][] = $this->construct('ItemCountRule', $arguments);
            }
        }

        $this->member("{$key}.*", $type->items, Presence::Required, Nullability::NotNull, Position::Item, $at->below('items'));
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

    private function position(Position $position): string
    {
        return $this->runtimeName('Position') . '::' . $position->name;
    }

    private function blankStrings(BlankStrings $checked): string
    {
        return $this->runtimeName('BlankStrings') . '::' . $checked->name;
    }

    /** @param list<string> $values */
    private static function stringList(array $values): string
    {
        return '[' . implode(', ', array_map(static fn (string $value): string => var_export($value, true), $values)) . ']';
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

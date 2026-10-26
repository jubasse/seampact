<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\EnumTypeUse;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Ir\Model\RefuseUnknownQuery;
use Seampact\Ir\Model\Refinements;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\TypeUse;
use Seampact\Ir\Model\UnknownKeysPolicy;
use Seampact\Symfony\Shared\SharedTypes;

/**
 * Each operation's generated input constraint and its validator (ADR 0024 "Types and validation"): the validator
 * declares the operation's input shape, which the copied runtime walks on the decoded input. Under `rules: native` a
 * value rule renders as Symfony's own constraint where Symfony has one (`Length`, `Count`, the comparisons,
 * `DivisibleBy`, `Regex`, `Uuid`), its contract rule in its `payload`, and a string with a pattern or a `uuid` format
 * also gets the generated check of the empty string, which those constraints pass unchecked. Under
 * `seampact-consistent` every rule is generated. Enums, unknown keys and the `date-time` format are generated in both.
 */
final class InputConstraintFiles
{
    private const PATTERN_DELIMITERS = ['/', '#', '~', '%', '!', '@', ';', ','];
    private const NATIVE_PATTERN_MODIFIERS = 'u';
    private const CONSISTENT_PATTERN_MODIFIERS = 'uD';
    private const FORMAT_UUID = 'uuid';
    private const FORMAT_DATE_TIME = 'date-time';
    private const DECIMAL_LITERAL = '/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/D';
    private const CONSTRAINTS = 'Symfony\\Component\\Validator\\Constraints\\';
    private const NUMBER_CONSTRAINTS = [
        'minimum' => 'GreaterThanOrEqual',
        'maximum' => 'LessThanOrEqual',
        'exclusiveMinimum' => 'GreaterThan',
        'exclusiveMaximum' => 'LessThan',
        'multipleOf' => 'DivisibleBy',
    ];

    private ClassFile $file;

    /** @var array<string, true> the schemas on the way to the current member */
    private array $visiting = [];

    public function __construct(
        private readonly ContractIR $ir,
        private readonly SharedTypes $shared,
        private readonly SymfonyPlacement $placement,
        private readonly RulesMode $rules,
        private readonly GenerationProblems $problems,
    ) {
        $this->file = new ClassFile($placement->namespace);
    }

    /** @return list<ClassFile> the operation's constraint and its validator */
    public function files(Operation $operation, int $index): array
    {
        $names = $this->shared->operation($operation->id);

        $constraint = new ClassFile($this->placement->inputConstraint($names));
        $constraint->namespace->addClass($constraint->shortName)->setFinal()
            ->setExtends($constraint->type($this->placement->runtime('InputConstraint')))
            ->addComment("The contract input of operation '{$operation->id}', checked by its validator on the decoded input.");

        $this->file = new ClassFile($this->placement->inputConstraintValidator($names));
        $class = $this->file->namespace->addClass($this->file->shortName)->setFinal()
            ->setExtends($this->file->type($this->placement->runtime('InputConstraintValidator')))
            ->addComment("The members of the input of operation '{$operation->id}', as the contract declares them.");
        $shape = $class->addMethod('shape')->setProtected()->setReturnType($this->placement->runtime('InputShape'));
        $this->file->name($this->placement->runtime('InputShape'));
        $shape->setBody('return ' . $this->inputShape($operation, $index) . ';');

        return [$constraint, $this->file];
    }

    private function inputShape(Operation $operation, int $index): string
    {
        $at = "/operations/{$index}";
        $arguments = [];

        $parts = ['path' => $operation->params->path, 'query' => $operation->params->query, 'header' => $this->shared->handlerHeaders($operation)];
        foreach ($parts as $part => $params) {
            if ($params !== []) {
                $arguments[] = "{$part}: " . $this->params($part, $params, $operation, "{$at}/params/{$part}");
            }
        }

        if ($operation->unknownQuery instanceof RefuseUnknownQuery) {
            $arguments[] = 'unknownQuery: ' . $this->runtimeCase('KeyPolicy', 'Refuse');
        }

        if ($operation->input !== null) {
            $arguments[] = 'body: ' . $this->member($operation->input->schema, true, false, $operation, "{$at}/input/schema", 1);
        }

        return $this->construct('InputShape', $arguments, 0);
    }

    /** @param array<int, Param> $params */
    private function params(string $part, array $params, Operation $operation, string $at): string
    {
        $entries = [];
        foreach ($params as $paramIndex => $param) {
            $required = $part === 'path' || $param->required;
            $entries[] = var_export($param->name, true) . ' => ' . $this->member($param->type, $required, false, $operation, "{$at}/{$paramIndex}/type", 2);
        }

        return self::listed($entries, 1);
    }

    private function member(TypeUse $type, bool $required, bool $nullable, Operation $operation, string $at, int $depth): string
    {
        $nullable = $nullable || match (true) {
            $type instanceof ScalarTypeUse, $type instanceof EnumTypeUse, $type instanceof RefTypeUse, $type instanceof ArrayTypeUse => $type->nullable === true,
            default => false,
        };

        $arguments = match (true) {
            $type instanceof ScalarTypeUse => $this->scalar($type, $operation, $at),
            $type instanceof EnumTypeUse => [$this->runtimeCase('JsonType', 'String'), 'checks: ' . $this->construct('Checks', ['enumValues: ' . $this->enumValues($type)], -1)],
            $type instanceof RefTypeUse => $this->object($type, $operation, $at, $depth),
            $type instanceof ArrayTypeUse => $this->list($type, $operation, $at, $depth),
            default => $this->refused($type, $operation, $at),
        };

        if (!$required) {
            $arguments[] = 'presence: ' . $this->runtimeCase('Presence', 'Optional');
        }
        if ($nullable) {
            $arguments[] = 'nullability: ' . $this->runtimeCase('Nullability', 'Nullable');
        }

        return $this->construct('Member', $this->ordered($arguments), $depth);
    }

    /** @return list<string> */
    private function scalar(ScalarTypeUse $type, Operation $operation, string $at): array
    {
        $jsonType = match ($type->type->value) {
            ScalarType::String => 'String',
            ScalarType::Integer => 'Integer',
            ScalarType::Number => 'Number',
            ScalarType::Boolean => 'Boolean',
            default => null,
        };
        if ($jsonType === null) {
            $this->problems->add('ir.value.unknown', "The scalar type '{$type->type->value}' is not one this release of the symfony target knows.", 'Update seampact/symfony to a release that reads this IR revision.', "{$at}/type", $operation->id);

            return [$this->runtimeCase('JsonType', 'String')];
        }
        if ($type->content !== null) {
            $this->waiting('type.content', 'A string member holding encoded JSON content', $operation, "{$at}/content");
        }

        $checks = [];
        $native = [];
        $this->format($type, $checks, $native, $operation, $at);
        match ($jsonType) {
            'String' => $this->stringRules($type->refinements, $checks, $native, $operation, $at),
            'Integer', 'Number' => $this->numberRules($type->refinements, $checks, $native, $operation, $at),
            default => null,
        };

        return [$this->runtimeCase('JsonType', $jsonType), ...$this->rendered($checks, $native)];
    }

    /**
     * @param list<string> $checks
     * @param list<string> $native
     */
    private function format(ScalarTypeUse $type, array &$checks, array &$native, Operation $operation, string $at): void
    {
        if ($type->format === null) {
            return;
        }

        if ($type->format === self::FORMAT_UUID && $this->rules === RulesMode::Native) {
            $native[] = $this->symfonyConstraint('Uuid', [], 'FORMAT');
            $checks[] = 'format: ' . $this->runtimeCase('Format', 'Uuid');
            $checks[] = 'formatScope: ' . $this->runtimeCase('PatternScope', 'EmptyStringOnly');

            return;
        }

        $case = match ($type->format) {
            self::FORMAT_UUID => 'Uuid',
            self::FORMAT_DATE_TIME => 'DateTime',
            default => null,
        };
        if ($case === null) {
            $this->waiting("format.{$type->format}", "The string format '{$type->format}'", $operation, "{$at}/format");

            return;
        }

        $checks[] = 'format: ' . $this->runtimeCase('Format', $case);
    }

    /**
     * @param list<string> $checks
     * @param list<string> $native
     */
    private function stringRules(Refinements $refinements, array &$checks, array &$native, Operation $operation, string $at): void
    {
        $isNative = $this->rules === RulesMode::Native;
        $pattern = null;
        if ($refinements->pattern !== null) {
            $pattern = self::pcre($refinements->pattern->normalized, $isNative ? self::NATIVE_PATTERN_MODIFIERS : self::CONSISTENT_PATTERN_MODIFIERS);
            if ($pattern === null) {
                $this->waiting('pattern.delimiter', 'A pattern holding every PCRE delimiter the target uses (' . implode(' ', self::PATTERN_DELIMITERS) . ')', $operation, "{$at}/refinements/pattern");
            }
        }

        if (!$isNative) {
            foreach (['minLength' => $refinements->minLength, 'maxLength' => $refinements->maxLength] as $rule => $value) {
                if ($value !== null) {
                    $checks[] = "{$rule}: {$value}";
                }
            }
            if ($pattern !== null) {
                $checks[] = 'pattern: ' . var_export($pattern, true);
            }

            return;
        }

        if ($refinements->minLength !== null) {
            $native[] = $this->symfonyConstraint('Length', ["min: {$refinements->minLength}"], 'MIN_LENGTH');
        }
        if ($refinements->maxLength !== null) {
            $native[] = $this->symfonyConstraint('Length', ["max: {$refinements->maxLength}"], 'MAX_LENGTH');
        }
        if ($pattern !== null) {
            $native[] = $this->symfonyConstraint('Regex', ['pattern: ' . var_export($pattern, true)], 'PATTERN');
            $checks[] = 'pattern: ' . var_export($pattern, true);
            $checks[] = 'patternScope: ' . $this->runtimeCase('PatternScope', 'EmptyStringOnly');
        }
    }

    /**
     * @param list<string> $checks
     * @param list<string> $native
     */
    private function numberRules(Refinements $refinements, array &$checks, array &$native, Operation $operation, string $at): void
    {
        $bounds = [
            'minimum' => $refinements->minimum,
            'maximum' => $refinements->maximum,
            'exclusiveMinimum' => $refinements->exclusiveMinimum,
            'exclusiveMaximum' => $refinements->exclusiveMaximum,
            'multipleOf' => $refinements->multipleOf,
        ];

        foreach ($bounds as $rule => $decimal) {
            if ($decimal === null) {
                continue;
            }
            if (preg_match(self::DECIMAL_LITERAL, $decimal) !== 1) {
                $this->problems->add('ir.value.invalid', "The {$rule} '{$decimal}' is not a decimal number.", 'Recompile the contract with a matching seampact compiler.', "{$at}/refinements/{$rule}", $operation->id);
                continue;
            }

            if ($this->rules === RulesMode::Native) {
                $native[] = $this->symfonyConstraint(self::NUMBER_CONSTRAINTS[$rule], ["value: {$decimal}"], strtoupper((string) preg_replace('/(?<!^)[A-Z]/', '_$0', $rule)));
            } else {
                $checks[] = "{$rule}: {$decimal}";
            }
        }
    }

    /** @return list<string> */
    private function object(RefTypeUse $type, Operation $operation, string $at, int $depth): array
    {
        $schema = $this->ir->schemas[$type->schema] ?? null;
        if (!$schema instanceof ObjectSchema) {
            $kind = $schema === null ? 'missing' : $schema->tag();
            $this->waiting("type.{$kind}", "The {$kind} schema '{$type->schema}' in an input", $operation, $at);

            return [$this->runtimeCase('JsonType', 'Object')];
        }

        if (isset($this->visiting[$type->schema])) {
            $this->waiting('schema.recursive', "The schema '{$type->schema}', which holds itself, in a request", $operation, $at);

            return [$this->runtimeCase('JsonType', 'Object')];
        }

        $this->visiting[$type->schema] = true;
        $properties = [];
        foreach ($schema->properties as $propertyIndex => $property) {
            $properties[] = var_export($property->name, true) . ' => '
                . $this->member($property->type, !$property->optional, $property->nullable, $operation, "/schemas/{$type->schema}/properties/{$propertyIndex}/type", $depth + 2);
        }
        unset($this->visiting[$type->schema]);

        $arguments = [$this->runtimeCase('JsonType', 'Object')];
        if ($properties !== []) {
            $arguments[] = 'properties: ' . self::listed($properties, $depth + 1);
        }
        if (($type->unknownKeys?->policy->value ?? UnknownKeysPolicy::Refuse) !== UnknownKeysPolicy::Refuse) {
            $arguments[] = 'unknownKeys: ' . $this->runtimeCase('KeyPolicy', 'Keep');
        }

        return $arguments;
    }

    /** @return list<string> */
    private function list(ArrayTypeUse $type, Operation $operation, string $at, int $depth): array
    {
        $checks = [];
        $native = [];
        foreach (['minItems' => [$type->minItems, 'min', 'MIN_ITEMS'], 'maxItems' => [$type->maxItems, 'max', 'MAX_ITEMS']] as $rule => [$value, $countArgument, $ruleConstant]) {
            if ($value === null) {
                continue;
            }
            if ($this->rules === RulesMode::Native) {
                $native[] = $this->symfonyConstraint('Count', ["{$countArgument}: {$value}"], $ruleConstant);
            } else {
                $checks[] = "{$rule}: {$value}";
            }
        }

        return [
            $this->runtimeCase('JsonType', 'List'),
            ...$this->rendered($checks, $native),
            'items: ' . $this->member($type->items, true, false, $operation, "{$at}/items", $depth + 1),
        ];
    }

    /** @return list<string> */
    private function refused(TypeUse $type, Operation $operation, string $at): array
    {
        $this->waiting("type.{$type->tag()}", "A {$type->tag()} type in an input", $operation, $at);

        return [$this->runtimeCase('JsonType', 'String')];
    }

    private function enumValues(EnumTypeUse $type): string
    {
        $values = $type->narrowedTo->values ?? $this->ir->enums[$type->enum]->values ?? [];

        return '[' . implode(', ', array_map(static fn (string $value): string => var_export($value, true), $values)) . ']';
    }

    /**
     * @param list<string> $checks
     * @param list<string> $native
     * @return list<string>
     */
    private function rendered(array $checks, array $native): array
    {
        $arguments = [];
        if ($checks !== []) {
            $arguments[] = 'checks: ' . $this->construct('Checks', $checks, -1);
        }
        if ($native !== []) {
            $arguments[] = 'native: [' . implode(', ', $native) . ']';
        }

        return $arguments;
    }

    /**
     * The member's arguments in the constructor's order, so the generated text reads the same for every member.
     *
     * @param list<string> $arguments
     * @return list<string>
     */
    private function ordered(array $arguments): array
    {
        $order = ['presence:', 'nullability:', 'checks:', 'native:', 'properties:', 'unknownKeys:', 'items:'];
        $rank = static function (string $argument) use ($order): int {
            foreach ($order as $position => $prefix) {
                if (str_starts_with($argument, $prefix)) {
                    return $position + 1;
                }
            }

            return 0;
        };
        usort($arguments, static fn (string $first, string $second): int => $rank($first) <=> $rank($second));

        return $arguments;
    }

    /** @param list<string> $arguments */
    private function symfonyConstraint(string $constraint, array $arguments, string $ruleConstant): string
    {
        $arguments[] = 'payload: ' . $this->file->name($this->placement->runtime('Rule')) . '::payload(' . $this->file->name($this->placement->runtime('Rule')) . "::{$ruleConstant})";

        return 'new ' . $this->file->name(self::CONSTRAINTS . $constraint) . '(' . implode(', ', $arguments) . ')';
    }

    /**
     * A constructor call on one line, or one argument per line indented by `$depth` tabs; `-1` keeps one line.
     *
     * @param list<string> $arguments
     */
    private function construct(string $runtimeClass, array $arguments, int $depth): string
    {
        $call = 'new ' . $this->file->name($this->placement->runtime($runtimeClass)) . '(';
        if ($depth < 0 || $arguments === [] || (count($arguments) === 1 && !str_contains($arguments[0], "\n"))) {
            return $call . implode(', ', $arguments) . ')';
        }

        $indent = str_repeat("\t", $depth + 1);

        return $call . "\n" . $indent . implode(",\n{$indent}", $arguments) . ",\n" . str_repeat("\t", $depth) . ')';
    }

    /** @param list<string> $entries */
    private static function listed(array $entries, int $depth): string
    {
        $indent = str_repeat("\t", $depth + 1);

        return "[\n{$indent}" . implode(",\n{$indent}", $entries) . ",\n" . str_repeat("\t", $depth) . ']';
    }

    private function runtimeCase(string $runtimeEnum, string $case): string
    {
        return $this->file->name($this->placement->runtime($runtimeEnum)) . "::{$case}";
    }

    private function waiting(string $form, string $description, Operation $operation, string $at): void
    {
        $this->problems->add(
            "{$form}.unsupported",
            "{$description} is not generated by the symfony target: it waits for a contract that needs it.",
            'Remove it from the operations this entry keeps (its `operations` filter), or wait for a release that generates it.',
            $at,
            $operation->id,
        );
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
}

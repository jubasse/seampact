<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\KeptForms;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RulesMode;
use Seampact\Codegen\Delivery;
use Seampact\Codegen\IntegerStep;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\PcrePattern;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\EnumTypeUse;
use Seampact\Ir\Model\InputProof;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Model\OpaqueTypeUse;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Ir\Model\Refinements;
use Seampact\Ir\Model\RefuseUnknownQuery;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\TypeUse;
use Seampact\Ir\Model\UnknownKeysPolicy;

/**
 * Each operation's generated input constraint and its validator (ADR 0024 "Types and validation"): the validator
 * declares the operation's input shape, which the copied runtime walks on the decoded input. Under `rules: native` a
 * value rule renders as Symfony's own constraint where Symfony has one (`Length`, `Count`, the comparisons,
 * `DivisibleBy`, `Regex`), its contract rule in its `payload`, and a string with a pattern also gets the generated
 * check of the empty string, which `Regex` passes unchecked. Under `seampact-consistent` every rule is generated.
 * Enums, unknown keys and the formats are generated in both: Symfony's `Uuid` refuses RFC 9562 text the contract
 * takes (the nil UUID, versions outside 1 to 8).
 */
final class InputConstraintFiles
{
    public const NATIVE_PATTERN_MODIFIERS = 'u';
    public const CONSISTENT_PATTERN_MODIFIERS = 'uD';
    private const CONSTRAINTS = 'Symfony\\Component\\Validator\\Constraints\\';

    private PhpClassFile $file;

    /** @var array<string, true> the schemas on the way to the current member */
    private array $visiting = [];

    public function __construct(
        private readonly ContractIR $ir,
        private readonly SymfonyPlacement $placement,
        private readonly RulesMode $rules,
        private readonly Refusals $refusals,
    ) {
        $this->file = new PhpClassFile($placement->namespace);
    }

    /** @return list<PhpClassFile> the operation's constraint and its validator */
    public function files(Operation $operation, IrPlace $at): array
    {
        $constraint = new PhpClassFile($this->placement->inputConstraint($operation->id));
        $constraint->namespace->addClass($constraint->shortName)->setFinal()
            ->setExtends($constraint->type($this->placement->runtime('InputConstraint')))
            ->addComment("The contract input of operation '{$operation->id}', checked by its validator on the decoded input.");

        $this->file = new PhpClassFile($this->placement->inputConstraintValidator($operation->id));
        $class = $this->file->namespace->addClass($this->file->shortName)->setFinal()
            ->setExtends($this->file->type($this->placement->runtime('InputConstraintValidator')))
            ->addComment("The members of the input of operation '{$operation->id}', as the contract declares them.");
        $shape = $class->addMethod('shape')->setProtected()->setReturnType($this->placement->runtime('InputShape'));
        $this->file->name($this->placement->runtime('InputShape'));
        $shape->setBody('return ' . $this->inputShape($operation, $at) . ';');

        return [$constraint, $this->file];
    }

    private function inputShape(Operation $operation, IrPlace $at): string
    {
        $arguments = [];

        $parts = ['path' => $operation->params->path, 'query' => $operation->params->query, 'header' => KeptForms::handlerHeaders($operation)];
        foreach ($parts as $part => $params) {
            if ($params !== []) {
                $arguments[] = "{$part}: " . $this->params($part, $params, $at->below('params', $part));
            }
        }

        if ($operation->unknownQuery instanceof RefuseUnknownQuery) {
            $arguments[] = 'unknownQuery: ' . $this->runtimeCase('KeyPolicy', 'Refuse');
        }

        if ($operation->input !== null) {
            $arguments[] = 'body: ' . $this->member($operation->input->schema, true, false, $at->below('input', 'schema'), 1);
            $proofNames = array_map(static fn (InputProof $proof): string => var_export($proof->name, true), $operation->input->proofs ?? []);
            if ($proofNames !== []) {
                $arguments[] = 'bodyProofs: [' . implode(', ', $proofNames) . ']';
            }
        }

        return $this->construct('InputShape', $arguments, 0);
    }

    /** @param array<int, Param> $params */
    private function params(string $part, array $params, IrPlace $at): string
    {
        $entries = [];
        foreach ($params as $paramIndex => $param) {
            $required = $part === 'path' || $param->required;
            $entries[] = var_export($param->name, true) . ' => ' . $this->member($param->type, $required, false, $at->below($paramIndex, 'type'), 2);
        }

        return self::listed($entries, 1);
    }

    private function member(TypeUse $type, bool $required, bool $nullable, IrPlace $at, int $depth): string
    {
        // An opaque value is never checked for null, as on the Spring and Laravel targets.
        $nullable = $nullable || match (true) {
            $type instanceof OpaqueTypeUse => true,
            $type instanceof ScalarTypeUse, $type instanceof EnumTypeUse, $type instanceof RefTypeUse, $type instanceof ArrayTypeUse => $type->nullable === true,
            default => false,
        };

        $arguments = match (true) {
            $type instanceof ScalarTypeUse => $this->scalar($type, $at),
            $type instanceof EnumTypeUse => [$this->runtimeCase('JsonType', 'String'), 'checks: ' . $this->construct('Checks', ['enumValues: ' . $this->enumValues($type)], -1)],
            $type instanceof RefTypeUse => $this->object($type, $at, $depth),
            $type instanceof ArrayTypeUse => $this->list($type, $at, $depth),
            $type instanceof OpaqueTypeUse => [$this->runtimeCase('JsonType', 'Any')],
            default => throw new \LogicException("The {$type->tag()} type use was kept but has no input check."),
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
    private function scalar(ScalarTypeUse $type, IrPlace $at): array
    {
        $jsonType = match ($type->type->value) {
            ScalarType::String => 'String',
            ScalarType::Integer => 'Integer',
            ScalarType::Number => 'Number',
            ScalarType::Boolean => 'Boolean',
            default => null,
        };
        if ($jsonType === null) {
            throw new \LogicException("The scalar type '{$type->type->value}' was kept but has no JSON type.");
        }

        $checks = [];
        $native = [];
        $this->format($type, $checks);
        match ($jsonType) {
            'String' => $this->stringRules($type->refinements, $checks, $native, $at),
            'Integer', 'Number' => $this->numberRules($type, $checks, $native, $at),
            default => null,
        };

        return [$this->runtimeCase('JsonType', $jsonType), ...$this->rendered($checks, $native)];
    }

    /**
     * @param list<string> $checks
     */
    private function format(ScalarTypeUse $type, array &$checks): void
    {
        if ($type->format === null) {
            return;
        }

        $case = match ($type->format) {
            KeptForms::FORMAT_UUID => 'Uuid',
            KeptForms::FORMAT_DATE_TIME => 'DateTime',
            default => null,
        };
        if ($case === null) {
            throw new \LogicException("The format '{$type->format}' was kept but has no generated check.");
        }

        $checks[] = 'format: ' . $this->runtimeCase('Format', $case);
    }

    /**
     * @param list<string> $checks
     * @param list<string> $native
     */
    private function stringRules(Refinements $refinements, array &$checks, array &$native, IrPlace $at): void
    {
        $isNative = $this->rules === RulesMode::Native;
        $pattern = null;
        if ($refinements->pattern !== null) {
            $pattern = PcrePattern::of($refinements->pattern->normalized, $isNative ? self::NATIVE_PATTERN_MODIFIERS : self::CONSISTENT_PATTERN_MODIFIERS);
            if ($pattern === null) {
                PcrePattern::refuse($this->refusals, $at->below('refinements', 'pattern'));
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
    private function numberRules(ScalarTypeUse $type, array &$checks, array &$native, IrPlace $at): void
    {
        foreach (NumberBounds::of($type->refinements, $at, $this->refusals) as $rule => $decimal) {
            if ($this->rules === RulesMode::Native) {
                $native[] = $this->symfonyConstraint(NumberBounds::CONSTRAINTS[$rule], ["value: {$decimal}"], self::ruleConstant($rule));
            } else {
                $checks[] = "{$rule}: {$decimal}";
            }
        }

        // The exact integer step, which `DivisibleBy` divides exactly as ints and the generated check as well.
        $step = IntegerStep::ofMember($type, $at->below('refinements', 'multipleOf'), $this->refusals);
        if ($step === null) {
            return;
        }
        if ($this->rules === RulesMode::Native) {
            $native[] = $this->symfonyConstraint('DivisibleBy', ["value: {$step}"], self::ruleConstant('multipleOf'));
        } else {
            $checks[] = "multipleOf: {$step}";
        }
    }

    private static function ruleConstant(string $rule): string
    {
        return strtoupper((string) preg_replace('/(?<!^)[A-Z]/', '_$0', $rule));
    }

    /** @return list<string> */
    private function object(RefTypeUse $type, IrPlace $at, int $depth): array
    {
        $schema = $this->ir->schemas[$type->schema] ?? null;
        if (!$schema instanceof ObjectSchema) {
            throw new \LogicException("The schema '{$type->schema}' was kept but is not an object.");
        }

        if (isset($this->visiting[$type->schema])) {
            $this->refusals->waiting('schema.recursive', "The schema '{$type->schema}', which holds itself, in a request", IrPlace::root()->below('schemas', $type->schema), Delivery::AfterOneZero);

            return [$this->runtimeCase('JsonType', 'Object')];
        }

        $this->visiting[$type->schema] = true;
        $properties = [];
        foreach ($schema->properties as $propertyIndex => $property) {
            $properties[] = var_export($property->name, true) . ' => '
                . $this->member($property->type, !$property->optional, $property->nullable, IrPlace::root()->below('schemas', $type->schema, 'properties', $propertyIndex, 'type'), $depth + 2);
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
    private function list(ArrayTypeUse $type, IrPlace $at, int $depth): array
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
            'items: ' . $this->member($type->items, true, false, $at->below('items'), $depth + 1),
        ];
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
}

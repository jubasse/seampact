<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\Literal;
use Nette\PhpGenerator\PromotedParameter;
use Seampact\Codegen\IntegerStep;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\PcrePattern;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpTypes;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RulesMode;
use Seampact\Codegen\SchemaMemberAttributes;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\OpaqueTypeUse;
use Seampact\Ir\Model\Property;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Ir\Model\Refinements;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\TypeUse;

/**
 * Symfony Validator attributes on the members of the generated schema classes, for the app's own `validate()` calls
 * (ADR 0024 "Options"). A rule gets the Symfony constraint whose meaning is the contract's: `NotNull` on a
 * required member that is not nullable, `Valid` on a member that holds objects, `Length` (in code points), `Count`,
 * one comparison per bound, `DivisibleBy` for the integer step, and `All` for list items. `Regex` is added under
 * `rules: native` only, since it passes an empty string unchecked. Left out: the `uuid` format (Symfony's `Uuid`
 * refuses RFC 9562 text the contract takes), enums and `date-time` (their PHP types hold them), opaque values, and a
 * member both optional and nullable, whose `Field` wrapper Symfony does not read. The boundary does not use these
 * attributes: it checks the decoded input with the generated input constraints.
 */
final class SchemaConstraints implements SchemaMemberAttributes
{
    private const CONSTRAINTS_NAMESPACE = 'Symfony\\Component\\Validator\\Constraints';
    private const CONSTRAINTS_ALIAS = 'Assert';
    private const PATTERN_MODIFIERS = 'u';
    private const VALID = 'Valid';

    public function __construct(private readonly RulesMode $rules, private readonly Refusals $refusals)
    {
    }

    public function addTo(PromotedParameter $parameter, Property $property, PhpClassFile $file, IrPlace $at): void
    {
        if ($property->optional && $property->nullable) {
            return;
        }

        $notNull = !$property->optional && !$property->nullable;
        foreach ($this->constraints($property->type, $notNull, $at->below('type'), $file) as [$constraint, $arguments]) {
            $file->alias(self::CONSTRAINTS_NAMESPACE, self::CONSTRAINTS_ALIAS);
            $parameter->addAttribute(self::CONSTRAINTS_NAMESPACE . '\\' . $constraint, array_map(static fn (string $code): Literal => new Literal($code), $arguments));
        }
    }

    /**
     * The constraints of a value of `$type`, each its short name and its named arguments as PHP code.
     *
     * @return list<array{string, array<string, string>}>
     */
    private function constraints(TypeUse $type, bool $notNull, IrPlace $at, PhpClassFile $file): array
    {
        if ($type instanceof OpaqueTypeUse) {
            return [];
        }

        $constraints = [];
        if ($notNull && !PhpTypes::isNullable($type)) {
            $constraints[] = ['NotNull', []];
        }
        if (self::holdsObjects($type)) {
            $constraints[] = [self::VALID, []];
        }

        if ($type instanceof ScalarTypeUse && $type->type->value === ScalarType::String) {
            array_push($constraints, ...$this->stringRules($type->refinements, $at));
        }
        if ($type instanceof ScalarTypeUse && in_array($type->type->value, [ScalarType::Integer, ScalarType::Number], true)) {
            array_push($constraints, ...$this->numberRules($type, $at));
        }
        if ($type instanceof ArrayTypeUse) {
            array_push($constraints, ...$this->listRules($type, $at, $file));
        }

        return $constraints;
    }

    /** @return list<array{string, array<string, string>}> */
    private function stringRules(Refinements $refinements, IrPlace $at): array
    {
        $constraints = [];
        $length = array_filter(['min' => $refinements->minLength, 'max' => $refinements->maxLength], static fn (?int $value): bool => $value !== null);
        if ($length !== []) {
            $constraints[] = ['Length', array_map(static fn (int $value): string => (string) $value, $length)];
        }

        // Under `seampact-consistent`, no Symfony constraint gives the contract's meaning: `Regex` passes "".
        if ($refinements->pattern === null || $this->rules !== RulesMode::Native) {
            return $constraints;
        }

        $pattern = PcrePattern::of($refinements->pattern->normalized, self::PATTERN_MODIFIERS);
        if ($pattern === null) {
            PcrePattern::refuse($this->refusals, $at->below('refinements', 'pattern'));

            return $constraints;
        }
        $constraints[] = ['Regex', ['pattern' => var_export($pattern, true)]];

        return $constraints;
    }

    /** @return list<array{string, array<string, string>}> */
    private function numberRules(ScalarTypeUse $type, IrPlace $at): array
    {
        $constraints = [];
        foreach (NumberBounds::of($type->refinements, $at, $this->refusals) as $rule => $decimal) {
            $constraints[] = [NumberBounds::CONSTRAINTS[$rule], ['value' => $decimal]];
        }

        $step = IntegerStep::ofMember($type, $at->below('refinements', 'multipleOf'), $this->refusals);
        if ($step !== null) {
            $constraints[] = ['DivisibleBy', ['value' => (string) $step]];
        }

        return $constraints;
    }

    /** @return list<array{string, array<string, string>}> */
    private function listRules(ArrayTypeUse $type, IrPlace $at, PhpClassFile $file): array
    {
        $constraints = [];
        $count = array_filter(['min' => $type->minItems, 'max' => $type->maxItems], static fn (?int $value): bool => $value !== null);
        if ($count !== []) {
            $constraints[] = ['Count', array_map(static fn (int $value): string => (string) $value, $count)];
        }

        $itemConstraints = [];
        foreach ($this->constraints($type->items, true, $at->below('items'), $file) as [$constraint, $arguments]) {
            if ($constraint === self::VALID) {
                continue;
            }

            $prefix = $file->alias(self::CONSTRAINTS_NAMESPACE, self::CONSTRAINTS_ALIAS);
            $named = array_map(static fn (string $name, string $code): string => "{$name}: {$code}", array_keys($arguments), $arguments);
            $itemConstraints[] = "new {$prefix}\\{$constraint}(" . implode(', ', $named) . ')';
        }
        if ($itemConstraints !== []) {
            $constraints[] = ['All', ['constraints' => '[' . implode(', ', $itemConstraints) . ']']];
        }

        return $constraints;
    }

    // `Valid` cannot sit inside `All`; on the member, it walks nested lists to every object they hold.
    private static function holdsObjects(TypeUse $type): bool
    {
        return $type instanceof RefTypeUse || ($type instanceof ArrayTypeUse && self::holdsObjects($type->items));
    }
}

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
 * one comparison per bound, `DivisibleBy` for the integer step, `All` for list items, and `Regex` with the boundary's
 * modifiers for the rules mode, beside `NotEqualTo('')` when the pattern refuses the empty string `Regex` skips.
 * Left out: the `uuid` format (Symfony's `Uuid` refuses RFC 9562 text the contract takes), enums and `date-time`
 * (their PHP types hold them, so a length or pattern on a `date-time` member is left out too), opaque values, and a
 * member both optional and nullable, whose `Field` wrapper Symfony does not read. A rule no attribute can write is
 * never refused: the class's docblock names it. The boundary does not use these
 * attributes: it checks the decoded input with the generated input constraints.
 */
final class SchemaConstraints implements SchemaMemberAttributes
{
    private const CONSTRAINTS_NAMESPACE = 'Symfony\\Component\\Validator\\Constraints';
    private const CONSTRAINTS_ALIAS = 'Assert';
    private const VALID = 'Valid';

    public function __construct(private readonly RulesMode $rules)
    {
    }

    public function addTo(PromotedParameter $parameter, Property $property, PhpClassFile $file, IrPlace $at): void
    {
        if ($property->optional && $property->nullable) {
            return;
        }

        $leftOut = [];
        $notNull = !$property->optional && !$property->nullable;
        foreach ($this->constraints($property->type, $notNull, $file, $leftOut) as [$constraint, $arguments]) {
            $file->alias(self::CONSTRAINTS_NAMESPACE, self::CONSTRAINTS_ALIAS);
            $parameter->addAttribute(self::CONSTRAINTS_NAMESPACE . '\\' . $constraint, array_map(static fn (string $code): Literal => new Literal($code), $arguments));
        }

        // A rule no attribute can write is named on the class, never refused: the attributes are a convenience.
        if ($leftOut !== []) {
            $file->namespace->getClasses()[$file->shortName]
                ->addComment("Member '{$property->name}' has no Symfony attribute for " . implode('; ', $leftOut) . '.');
        }
    }

    /**
     * The constraints of a value of `$type`, each its short name and its named arguments as PHP code.
     *
     * @param list<string> $leftOut receives each rule no attribute can write
     * @return list<array{string, array<string, string>}>
     */
    private function constraints(TypeUse $type, bool $notNull, PhpClassFile $file, array &$leftOut): array
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

        if ($type instanceof ScalarTypeUse && $type->type->value === ScalarType::String && $type->format === PhpTypes::DATE_TIME_FORMAT) {
            self::leaveOutDateTimeStringRules($type->refinements, $leftOut);
        } elseif ($type instanceof ScalarTypeUse && $type->type->value === ScalarType::String) {
            array_push($constraints, ...$this->stringRules($type->refinements, $leftOut));
        }
        if ($type instanceof ScalarTypeUse && in_array($type->type->value, [ScalarType::Integer, ScalarType::Number], true)) {
            array_push($constraints, ...self::numberRules($type, $leftOut));
        }
        if ($type instanceof ArrayTypeUse) {
            array_push($constraints, ...$this->listRules($type, $file, $leftOut));
        }

        return $constraints;
    }

    /**
     * `Length` and `Regex` raise a type violation on the `DateTimeImmutable` of a `date-time` member.
     *
     * @param list<string> $leftOut
     */
    private static function leaveOutDateTimeStringRules(Refinements $refinements, array &$leftOut): void
    {
        $declared = array_keys(array_filter(['minLength' => $refinements->minLength, 'maxLength' => $refinements->maxLength, 'pattern' => $refinements->pattern], static fn (mixed $value): bool => $value !== null));
        if ($declared !== []) {
            $leftOut[] = 'its ' . implode(' and ', $declared) . ', which a `DateTimeImmutable` value does not hold';
        }
    }

    /**
     * @param list<string> $leftOut
     * @return list<array{string, array<string, string>}>
     */
    private function stringRules(Refinements $refinements, array &$leftOut): array
    {
        $constraints = [];
        $length = array_filter(['min' => $refinements->minLength, 'max' => $refinements->maxLength], static fn (?int $value): bool => $value !== null);
        if ($length !== []) {
            $constraints[] = ['Length', array_map(static fn (int $value): string => (string) $value, $length)];
        }

        if ($refinements->pattern === null) {
            return $constraints;
        }

        $modifiers = $this->rules === RulesMode::Native ? InputConstraintFiles::NATIVE_PATTERN_MODIFIERS : InputConstraintFiles::CONSISTENT_PATTERN_MODIFIERS;
        $pattern = PcrePattern::of($refinements->pattern->normalized, $modifiers);
        if ($pattern === null) {
            $leftOut[] = 'its pattern, which holds every PCRE delimiter';

            return $constraints;
        }
        $constraints[] = ['Regex', ['pattern' => var_export($pattern, true)]];

        // `Regex` skips "", which the contract checks against the pattern as the boundary does.
        $refusesEmptyString = preg_match($pattern, '') === 0;
        if ($refusesEmptyString && ($refinements->minLength ?? 0) < 1) {
            $constraints[] = ['NotEqualTo', ['value' => "''"]];
        }

        return $constraints;
    }

    /**
     * @param list<string> $leftOut
     * @return list<array{string, array<string, string>}>
     */
    private static function numberRules(ScalarTypeUse $type, array &$leftOut): array
    {
        $constraints = [];
        foreach (NumberBounds::declared($type->refinements) as $rule => $decimal) {
            if (!NumberBounds::isDecimal($decimal)) {
                $leftOut[] = "its {$rule} '{$decimal}', which is not a decimal number";
                continue;
            }

            $constraints[] = [NumberBounds::CONSTRAINTS[$rule], ['value' => $decimal]];
        }

        $step = $type->refinements->multipleOf;
        if ($step === null) {
            return $constraints;
        }

        $integerStep = $type->type->value === ScalarType::Integer && IntegerStep::isNonzeroDecimal($step) ? IntegerStep::of($step) : null;
        if ($integerStep === null) {
            $leftOut[] = "its multipleOf {$step}, which is no integer step within the PHP `int` range";

            return $constraints;
        }
        $constraints[] = ['DivisibleBy', ['value' => (string) $integerStep]];

        return $constraints;
    }

    /**
     * @param list<string> $leftOut
     * @return list<array{string, array<string, string>}>
     */
    private function listRules(ArrayTypeUse $type, PhpClassFile $file, array &$leftOut): array
    {
        $constraints = [];
        $count = array_filter(['min' => $type->minItems, 'max' => $type->maxItems], static fn (?int $value): bool => $value !== null);
        if ($count !== []) {
            $constraints[] = ['Count', array_map(static fn (int $value): string => (string) $value, $count)];
        }

        $itemConstraints = [];
        foreach ($this->constraints($type->items, true, $file, $leftOut) as [$constraint, $arguments]) {
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

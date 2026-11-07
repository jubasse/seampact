<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\IntegerStep;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\Refusals;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Model\Refinements;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Run\GenerationRefusedException;

final class IntegerStepTest extends TestCase
{
    public function testADecimalStepReducesToItsExactIntegerStep(): void
    {
        self::assertSame(3, IntegerStep::of('3'));
        self::assertSame(5, IntegerStep::of('2.5'));
        self::assertSame(7, IntegerStep::of('0.07'));
        self::assertSame(1, IntegerStep::of('0.5'));
        self::assertSame(3, IntegerStep::of('1.50'));
        self::assertSame(100, IntegerStep::of('1e2'));
        self::assertSame(1, IntegerStep::of('0.1'));
    }

    public function testAStepBeyondTheIntRangeIsNull(): void
    {
        self::assertNull(IntegerStep::of('100000000000000000000'));
        self::assertNull(IntegerStep::of('1e19'));
        self::assertSame(123456789012345678, IntegerStep::of('123456789012345678'));
    }

    public function testOnlyANonzeroDecimalIsAStep(): void
    {
        self::assertTrue(IntegerStep::isNonzeroDecimal('2.5'));
        self::assertFalse(IntegerStep::isNonzeroDecimal('0.00'));
        self::assertFalse(IntegerStep::isNonzeroDecimal('two'));
    }

    public function testAMemberStepIsRefusedOnANumberAndBeyondTheIntRange(): void
    {
        self::assertSame(['multipleOf.invalid'], self::refusedCodes(ScalarType::Number, '0.5'));
        self::assertSame(['multipleOf.wide.unsupported'], self::refusedCodes(ScalarType::Integer, '1e19'));
        self::assertSame([], self::refusedCodes(ScalarType::Integer, '2.5'));
    }

    /** @return list<string> */
    private static function refusedCodes(string $scalar, string $multipleOf): array
    {
        $refusals = new Refusals('server', 'symfony', 'seampact/symfony');
        IntegerStep::ofMember(new ScalarTypeUse(ScalarType::of($scalar), new Refinements(multipleOf: $multipleOf)), IrPlace::root(), $refusals);

        try {
            $refusals->throwIfAny();
        } catch (GenerationRefusedException $refused) {
            return array_map(static fn (ConfigProblem $problem): string => $problem->code, $refused->problems);
        }

        return [];
    }
}

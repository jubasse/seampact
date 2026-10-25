<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Hooks\Field;

final class FieldTest extends TestCase
{
    public function testKeepsTheThreeStatesApart(): void
    {
        $absent = Field::absent();
        $null = Field::ofNull();
        $present = Field::of('2026-10-26');

        self::assertSame([true, false, false], [$absent->isAbsent(), $absent->isNull(), $absent->isPresent()]);
        self::assertSame([false, true, false], [$null->isAbsent(), $null->isNull(), $null->isPresent()]);
        self::assertSame([false, false, true], [$present->isAbsent(), $present->isNull(), $present->isPresent()]);
        self::assertSame('2026-10-26', $present->value());
    }

    public function testRefusesNullAsAValue(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('use Field::ofNull() for null');

        Field::of(null);
    }

    public function testRefusesToReadAnAbsentValue(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('The field is absent; check isPresent() first.');

        Field::absent()->value();
    }
}

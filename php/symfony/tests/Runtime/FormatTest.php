<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\DateTimeVectors;
use Seampact\Symfony\Runtime\Format;

/** The string formats the target checks itself. */
final class FormatTest extends TestCase
{
    /** @return iterable<string, array{string, bool}> */
    public static function dateTimes(): iterable
    {
        return DateTimeVectors::all();
    }

    #[DataProvider('dateTimes')]
    public function testADateTimeIsAcceptedOnlyWhenItIsAnRfc3339InstantWithAnOffset(string $value, bool $accepted): void
    {
        self::assertSame($accepted, Format::DateTime->accepts($value));
    }

    public function testAUuidIsHyphenatedHexOfTheRightGroups(): void
    {
        self::assertTrue(Format::Uuid->accepts('7c9e6679-7425-40de-944b-e07fc1f90ae7'));
        self::assertTrue(Format::Uuid->accepts('7C9E6679-7425-40DE-944B-E07FC1F90AE7'));
        self::assertFalse(Format::Uuid->accepts('7c9e667974254 0de944be07fc1f90ae7'));
        self::assertFalse(Format::Uuid->accepts('7c9e6679-7425-40de-944b-e07fc1f90ae'));
        self::assertFalse(Format::Uuid->accepts("7c9e6679-7425-40de-944b-e07fc1f90ae7\n"));
        self::assertFalse(Format::Uuid->accepts(''));
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\WireValues;

/** The path segments the URL builders write, encoded as the generated clients send them (a number as JavaScript writes it). */
final class PathSegmentsTest extends TestCase
{
    /** @return iterable<string, array{string|int|float|bool|\BackedEnum|\DateTimeInterface, string}> */
    public static function segments(): iterable
    {
        yield 'unreserved and marks kept' => ["a-b_c.d~e!*'()", "a-b_c.d~e!*'()"];
        yield 'delimiters encoded' => ['a/b?c#d&e=f+g', 'a%2Fb%3Fc%23d%26e%3Df%2Bg'];
        yield 'a percent encoded again' => ['50%25', '50%2525'];
        yield 'space and multibyte' => ['ü Ω', '%C3%BC%20%CE%A9'];
        yield 'a dot inside a value' => ['..a', '..a'];
        yield 'integer' => [-42, '-42'];
        yield 'number' => [1.5, '1.5'];
        yield 'whole number' => [3.0, '3'];
        yield 'negative zero' => [-0.0, '0'];
        yield 'large whole number' => [1e20, '100000000000000000000'];
        yield 'number past the decimal range' => [1e25, '1e+25'];
        yield 'small number' => [0.000001, '0.000001'];
        yield 'number below the decimal range' => [1.5e-7, '1.5e-7'];
        yield 'boolean' => [false, 'false'];
        yield 'backed enum' => [PathSegmentStatus::InReview, 'in%20review'];
        yield 'date-time' => [new \DateTimeImmutable('2026-10-27T08:30:00+02:00'), '2026-10-27T08%3A30%3A00.000%2B02%3A00'];
    }

    #[DataProvider('segments')]
    public function testAValueIsWrittenAsOneEncodedSegment(string|int|float|bool|\BackedEnum|\DateTimeInterface $value, string $segment): void
    {
        self::assertSame($segment, WireValues::pathSegment('taskId', $value));
    }

    /** @return iterable<string, array{string|float}> */
    public static function otherRoutes(): iterable
    {
        yield 'empty' => [''];
        yield 'dot' => ['.'];
        yield 'dot dot' => ['..'];
        yield 'not finite' => [INF];
    }

    #[DataProvider('otherRoutes')]
    public function testAValueThatWouldReachAnotherRouteIsRefusedByName(string|float $value): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage("The path parameter 'taskId' must be");

        WireValues::pathSegment('taskId', $value);
    }
}

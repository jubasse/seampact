<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\WireCodec;

/** The reply side of an opaque value: a handler's `null` is written only where the contract makes it nullable. */
final class WireCodecTest extends TestCase
{
    private const OPAQUE = ['kind' => 'opaque', 'reason' => 'any webhook payload'];

    /** @return iterable<string, array{string, string}> */
    public static function dateTimes(): iterable
    {
        yield 'no fraction' => ['2026-10-27T08:30:00+02:00', '2026-10-27T08:30:00+02:00'];
        yield 'trailing zeros dropped' => ['2026-10-27T08:30:00.120+02:00', '2026-10-27T08:30:00.12+02:00'];
        yield 'one digit' => ['2026-10-27T08:30:00.500+00:00', '2026-10-27T08:30:00.5+00:00'];
        yield 'microseconds kept' => ['2026-10-27T08:30:00.000001+00:00', '2026-10-27T08:30:00.000001+00:00'];
        yield 'offset with seconds in UTC' => ['2026-10-27T08:30:00.5+02:00:30', '2026-10-27T06:29:30.5+00:00'];
    }

    #[DataProvider('dateTimes')]
    public function testADateTimeIsWrittenWithoutTrailingZerosInItsFraction(string $held, string $written): void
    {
        $type = ['kind' => 'scalar', 'type' => 'string', 'format' => 'date-time'];

        self::assertSame($written, WireCodec::encode(ApiContract::of(ThrottledContract::class), $type, new \DateTimeImmutable($held)));
    }

    public function testAnEmptyTableAndAnEmptyObjectAreWrittenAsBracesAndAnEmptyListAsBrackets(): void
    {
        $contract = ApiContract::of(OpaqueMembersContract::class);
        $json = static fn (mixed $written): string => json_encode($written, JSON_THROW_ON_ERROR);

        self::assertSame('{}', $json(WireCodec::encodeBody($contract, ['shape' => 'table', 'body' => self::OPAQUE], [])));
        self::assertSame('[]', $json(WireCodec::encodeBody($contract, ['shape' => 'list', 'body' => self::OPAQUE], [])));
        self::assertSame('{"payload":null,"meta":{}}', $json(WireCodec::encode($contract, ['kind' => 'ref', 'schema' => 'event'], new OpaqueMembersEvent(null, new \stdClass()))));
    }

    public function testANullOpaqueValueThatIsNotNullableIsABoundaryFailure(): void
    {
        $this->expectException(BoundaryFailure::class);

        WireCodec::encode(ApiContract::of(ThrottledContract::class), self::OPAQUE, null);
    }

    public function testANullOpaqueItemThatIsNotNullableIsABoundaryFailure(): void
    {
        $this->expectException(BoundaryFailure::class);

        WireCodec::encode(ApiContract::of(ThrottledContract::class), ['kind' => 'array', 'items' => self::OPAQUE], [1, null]);
    }

    public function testANullableOpaqueValueWritesNull(): void
    {
        $contract = ApiContract::of(ThrottledContract::class);

        self::assertNull(WireCodec::encode($contract, self::OPAQUE + ['nullable' => true], null));
        self::assertSame([1, null], WireCodec::encode($contract, ['kind' => 'array', 'items' => self::OPAQUE + ['nullable' => true]], [1, null]));
        self::assertSame([null], WireCodec::encode($contract, self::OPAQUE, [null]));
    }

    public function testAnObjectMemberTakesNullOnlyWhereItsOpaqueTypeIsNullable(): void
    {
        $contract = ApiContract::of(OpaqueMembersContract::class);
        $event = ['kind' => 'ref', 'schema' => 'event'];

        $written = WireCodec::encode($contract, $event, new OpaqueMembersEvent(null, ['a' => 1]));

        self::assertInstanceOf(\stdClass::class, $written);
        self::assertNull($written->payload);
        self::assertSame(['a' => 1], $written->meta);

        $this->expectException(BoundaryFailure::class);

        WireCodec::encode($contract, $event, new OpaqueMembersEvent(1, null));
    }
}

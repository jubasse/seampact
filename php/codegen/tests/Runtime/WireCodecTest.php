<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\WireCodec;

/** The reply side of an opaque value: a handler's `null` is written only where the contract makes it nullable. */
final class WireCodecTest extends TestCase
{
    private const OPAQUE = ['kind' => 'opaque', 'reason' => 'any webhook payload'];

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
}

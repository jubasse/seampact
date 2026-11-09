<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Symfony\Runtime\InputPointer;
use Seampact\Symfony\Tests\Support\InputRulesContract;

/** The wire pointer of a Symfony property path: code names back to wire names, indices kept. */
final class InputPointerTest extends TestCase
{
    public function testABodyMemberPointsAtItsWireName(): void
    {
        self::assertSame(['in' => 'body', 'pointer' => '/end'], self::pointer('body', 'end'));
    }

    public function testThePartItselfPointsAtTheRoot(): void
    {
        self::assertSame(['in' => 'body', 'pointer' => ''], self::pointer('body', ''));
    }

    public function testAnArrayIndexIsKeptAndTheNestedMemberGetsItsWireName(): void
    {
        self::assertSame(['in' => 'body', 'pointer' => '/tags/0/label-text'], self::pointer('body', 'tags[0].labelText'));
    }

    public function testAMemberThePathCannotMapPointsAtTheNearestMappedParent(): void
    {
        self::assertSame(['in' => 'body', 'pointer' => '/tags/1'], self::pointer('body', 'tags[1].unknown'));
        self::assertSame(['in' => 'body', 'pointer' => ''], self::pointer('body', 'unknown'));
    }

    public function testAHeaderIsNamedInLowerCaseUnderTheHeaderPart(): void
    {
        self::assertSame(['in' => 'header', 'pointer' => '/x-tenant'], self::pointer('headers', 'xTenant'));
    }

    public function testAQueryParameterPointsAtItsWireName(): void
    {
        self::assertSame(['in' => 'query', 'pointer' => '/dryRun'], self::pointer('query', 'dryRun'));
    }

    /** @return array{in: string, pointer: string} */
    private static function pointer(string $part, string $propertyPath): array
    {
        return InputPointer::of(ApiContract::of(InputRulesContract::class), 'scheduleTask', $part, $propertyPath);
    }
}

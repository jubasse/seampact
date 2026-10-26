<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\PublicOrigin;

/** The public origin absolute URLs start with, and its boot check, as the Spring target checks them. */
final class PublicOriginTest extends TestCase
{
    private const SETTING = 'seampact.tasks.public_origin';

    public function testRelativeUrlsNeedNoOrigin(): void
    {
        $contract = ApiContract::of(SelectionContract::class);

        self::assertNull(PublicOrigin::bootProblem($contract, self::SETTING, null));
        self::assertNull(PublicOrigin::of($contract, 'https://api.example.com'));
    }

    public function testAbsoluteUrlsWithoutTheOriginAreABootProblemNamingTheSetting(): void
    {
        $problem = PublicOrigin::bootProblem(ApiContract::of(AbsoluteUrlsContract::class), self::SETTING, null) ?? '';

        self::assertStringContainsString(self::SETTING, $problem);
        self::assertStringContainsString('is not set', $problem);
    }

    /** @return iterable<string, array{string}> */
    public static function refusedOrigins(): iterable
    {
        yield 'a trailing slash' => ['https://api.example.com/'];
        yield 'a path' => ['https://api.example.com/v1'];
        yield 'no scheme' => ['api.example.com'];
        yield 'another scheme' => ['ftp://api.example.com'];
        yield 'user info' => ['https://user@api.example.com'];
        yield 'a query' => ['https://api.example.com?x=1'];
    }

    #[DataProvider('refusedOrigins')]
    public function testAnOriginThatIsNotSchemeHostAndPortIsABootProblem(string $origin): void
    {
        $contract = ApiContract::of(AbsoluteUrlsContract::class);

        self::assertNotNull(PublicOrigin::bootProblem($contract, self::SETTING, $origin));
        self::assertNull(PublicOrigin::of($contract, $origin));
    }

    public function testASchemeHostAndPortIsTheOrigin(): void
    {
        $contract = ApiContract::of(AbsoluteUrlsContract::class);

        self::assertNull(PublicOrigin::bootProblem($contract, self::SETTING, 'https://api.example.com:8443'));
        self::assertSame('https://api.example.com:8443', PublicOrigin::of($contract, 'https://api.example.com:8443'));
    }
}

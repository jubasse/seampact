<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\FrameworkRoutes;

/**
 * The framework-route allow-list of the boot check, the rule Spring's `BootCheck.isAllowListed` shares: `*` takes
 * one segment, `**` any number, a `*` inside a segment any characters but `/`, an empty segment (`/a/`, `//`) is
 * dropped on both sides, and a method takes only a route
 * answering that one method besides HEAD.
 */
final class FrameworkRoutesTest extends TestCase
{
    public function testOneStarTakesExactlyOneSegment(): void
    {
        $allowed = [['path' => '/admin/*', 'method' => null]];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/admin/users', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/admin', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/admin/users/1', ['GET', 'HEAD']));
    }

    public function testTwoStarsTakeAnyNumberOfSegments(): void
    {
        $allowed = [['path' => '/__seampact/**', 'method' => null]];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/__seampact', ['PUT']));
        self::assertTrue(FrameworkRoutes::allows($allowed, '/__seampact/script', ['PUT']));
        self::assertTrue(FrameworkRoutes::allows($allowed, '/__seampact/a/b', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/__seampactx/script', ['PUT']));
    }

    public function testAStarInsideASegmentTakesAnyCharactersButASlash(): void
    {
        $allowed = [['path' => '/livewire-*/**', 'method' => null]];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/livewire-3f9a/upload-file', ['POST']));
        self::assertTrue(FrameworkRoutes::allows($allowed, '/livewire-/update', ['POST']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/live-3f9a/upload-file', ['POST']));
        self::assertTrue(
            FrameworkRoutes::allows([['path' => '/livewire*/**', 'method' => null]], '/livewire/update', ['POST']),
        );
        self::assertFalse(
            FrameworkRoutes::allows([['path' => '/livewire-*', 'method' => null]], '/livewire-3f9a/upload-file', ['POST']),
        );
        self::assertTrue(FrameworkRoutes::allows([['path' => '/*.json', 'method' => null]], '/up.json', ['GET']));
        self::assertFalse(FrameworkRoutes::allows([['path' => '/*.json', 'method' => null]], '/up.xml', ['GET']));
    }

    public function testAMethodTakesOnlyARouteAnsweringThatOneMethod(): void
    {
        $allowed = [['path' => '/v1/unlisted', 'method' => 'GET']];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/v1/unlisted', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/v1/unlisted', ['POST']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/v1/unlisted', ['GET', 'POST']));
    }

    /** @return iterable<string, array{string, string, bool}> */
    public static function emptySegments(): iterable
    {
        yield 'a trailing slash, as its path without it' => ['/a', '/a/', true];
        yield 'two stars over a trailing slash' => ['/a/**', '/a/', true];
        yield 'one star over a trailing slash' => ['/a/*', '/a/', false];
        yield 'a doubled slash, as one' => ['/a/b', '/a//b', true];
        yield 'one star over a doubled slash' => ['/a/*/b', '/a//b', false];
        yield 'the root' => ['/', '/', true];
        yield 'two stars over the root' => ['/**', '/', true];
        yield 'one star over the root' => ['/*', '/', false];
    }

    #[DataProvider('emptySegments')]
    public function testAnEmptySegmentIsDroppedOnBothSides(string $pattern, string $route, bool $allowed): void
    {
        self::assertSame($allowed, FrameworkRoutes::allows([['path' => $pattern, 'method' => null]], $route, ['GET']));
    }

    public function testALiteralSegmentIsNotAPattern(): void
    {
        self::assertFalse(FrameworkRoutes::allows([['path' => '/up.json', 'method' => null]], '/upxjson', ['GET']));
    }

    public function testAPatternTheMatcherCannotFinishIsABootErrorNamingIt(): void
    {
        $pattern = '/' . str_repeat('a*', 6) . 'b';

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("the frameworkRoutes pattern '{$pattern}'");

        // The JIT has no backtrack limit, so the test reads the limit the interpreter applies.
        $jit = ini_set('pcre.jit', '0');
        $backtrackLimit = ini_set('pcre.backtrack_limit', '1000');
        $route = '/' . str_repeat('a', 200) . 'bx';
        try {
            FrameworkRoutes::allows([['path' => $pattern, 'method' => null]], $route, ['GET']);
        } finally {
            ini_set('pcre.jit', (string) $jit);
            ini_set('pcre.backtrack_limit', (string) $backtrackLimit);
        }
    }
}

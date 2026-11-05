<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\FrameworkRoutes;

/**
 * The framework-route allow-list of the boot check, the rule Spring's `BootCheck.isAllowListed` shares: `*` takes
 * one segment, `**` any number, a `*` inside a segment any characters but `/`, an empty segment (`/a/`, `//`) is
 * dropped on both sides, a catch-all route segment is taken by `**` only, and a method takes only a route answering
 * that one method besides HEAD.
 */
final class FrameworkRoutesTest extends TestCase
{
    public function testTheDefaultScopeLeavesAnAppRouteOutsideTheContractBasePathsAlone(): void
    {
        self::assertFalse(FrameworkRoutes::overlapsAny(['/api/v1'], '/health'));
        self::assertFalse(FrameworkRoutes::overlapsAny(['/api/v1'], '/api'));
        self::assertFalse(FrameworkRoutes::overlapsAny(['/api/v1'], '/api/v2/users'));
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], '/api/v1'));
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], '/api/v1/docs'));
    }

    public function testAPlaceholderOrACatchAllRouteOverlapsTheBasePathItCanServe(): void
    {
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], '/{page}/v1/x'));
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], '/{a}/{b}'));
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], '/{any*}'), 'a catch-all serves every path below it');
        self::assertFalse(FrameworkRoutes::overlapsAny(['/api/v1'], '/{any}'), 'one segment serves /api, a parent of the base path only');
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], '/api/{rest}'), 'a placeholder serves the base path itself');
        self::assertFalse(FrameworkRoutes::overlapsAny(['/api/v1'], '/files/{rest}'));
    }

    public function testAPlaceholderWhosePatternTakesASlashIsACatchAll(): void
    {
        $patterns = ['any' => '.*', 'id' => '[0-9]+'];
        $patternOf = static fn (string $name): ?string => $patterns[$name] ?? null;

        self::assertSame('/{any*}', FrameworkRoutes::withCatchAlls('/{any}', $patternOf));
        self::assertSame('/users/{id}', FrameworkRoutes::withCatchAlls('/users/{id}', $patternOf));
        self::assertSame('/{page}', FrameworkRoutes::withCatchAlls('/{page}', $patternOf));
    }

    public function testAPlaceholderInsideASegmentWhosePatternTakesASlashIsACatchAll(): void
    {
        $patternOf = static fn (string $name): ?string => $name === 'rest' ? '.+' : null;

        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], FrameworkRoutes::withCatchAlls('/api{rest}', $patternOf)), 'Symfony matches /api/v1/tasks with rest=/v1/tasks');
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], FrameworkRoutes::withCatchAlls('/v{rest}', $patternOf)), 'a partial segment reads as a placeholder');
        self::assertFalse(FrameworkRoutes::overlapsAny(['/api/v1'], FrameworkRoutes::withCatchAlls('/api{page}', $patternOf)), 'the default pattern keeps to one segment');
    }

    public function testAPlaceholderPatternTheCheckCannotReadIsACatchAll(): void
    {
        $patternOf = static fn (string $name): ?string => $name === 'rest' ? 'v\\d/tasks' : null;

        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], FrameworkRoutes::withCatchAlls('/{rest}', $patternOf)));
        self::assertTrue(FrameworkRoutes::overlapsAny(['/api/v1'], FrameworkRoutes::withCatchAlls('/{rest', $patternOf)), 'an unclosed brace');
    }

    public function testAPlaceholderPatternThatKeepsToOneSegmentStaysOneSegment(): void
    {
        $patterns = ['uuid' => '[0-9a-f]{8}-[0-9a-f]{4}-[13-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', 'slug' => '[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*', 'lang' => 'en|fr', 'id' => '\\d+'];
        $patternOf = static fn (string $name): ?string => $patterns[$name] ?? null;

        foreach (array_keys($patterns) as $name) {
            self::assertSame("/{{$name}}", FrameworkRoutes::withCatchAlls("/{{$name}}", $patternOf));
        }
    }

    public function testAnEmptyBasePathOverlapsEveryRoute(): void
    {
        self::assertTrue(FrameworkRoutes::overlapsAny([''], '/health'));
        self::assertTrue(FrameworkRoutes::overlapsAny([''], '/'));
    }

    public function testOneStarTakesExactlyOneSegment(): void
    {
        $allowed = [['path' => '/admin/*', 'method' => null]];

        self::assertTrue(self::allowsWithDefaultPatterns($allowed, '/admin/users', ['GET', 'HEAD']));
        self::assertFalse(self::allowsWithDefaultPatterns($allowed, '/admin', ['GET', 'HEAD']));
        self::assertFalse(self::allowsWithDefaultPatterns($allowed, '/admin/users/1', ['GET', 'HEAD']));
    }

    public function testTwoStarsTakeAnyNumberOfSegments(): void
    {
        $allowed = [['path' => '/__seampact/**', 'method' => null]];

        self::assertTrue(self::allowsWithDefaultPatterns($allowed, '/__seampact', ['PUT']));
        self::assertTrue(self::allowsWithDefaultPatterns($allowed, '/__seampact/script', ['PUT']));
        self::assertTrue(self::allowsWithDefaultPatterns($allowed, '/__seampact/a/b', ['GET', 'HEAD']));
        self::assertFalse(self::allowsWithDefaultPatterns($allowed, '/__seampactx/script', ['PUT']));
    }

    public function testAStarInsideASegmentTakesAnyCharactersButASlash(): void
    {
        $allowed = [['path' => '/livewire-*/**', 'method' => null]];

        self::assertTrue(self::allowsWithDefaultPatterns($allowed, '/livewire-3f9a/upload-file', ['POST']));
        self::assertTrue(self::allowsWithDefaultPatterns($allowed, '/livewire-/update', ['POST']));
        self::assertFalse(self::allowsWithDefaultPatterns($allowed, '/live-3f9a/upload-file', ['POST']));
        self::assertTrue(
            self::allowsWithDefaultPatterns([['path' => '/livewire*/**', 'method' => null]], '/livewire/update', ['POST']),
        );
        self::assertFalse(
            self::allowsWithDefaultPatterns([['path' => '/livewire-*', 'method' => null]], '/livewire-3f9a/upload-file', ['POST']),
        );
        self::assertTrue(self::allowsWithDefaultPatterns([['path' => '/*.json', 'method' => null]], '/up.json', ['GET']));
        self::assertFalse(self::allowsWithDefaultPatterns([['path' => '/*.json', 'method' => null]], '/up.xml', ['GET']));
    }

    public function testAMethodTakesOnlyARouteAnsweringThatOneMethod(): void
    {
        $allowed = [['path' => '/v1/unlisted', 'method' => 'GET']];

        self::assertTrue(self::allowsWithDefaultPatterns($allowed, '/v1/unlisted', ['GET', 'HEAD']));
        self::assertFalse(self::allowsWithDefaultPatterns($allowed, '/v1/unlisted', ['POST']));
        self::assertFalse(self::allowsWithDefaultPatterns($allowed, '/v1/unlisted', ['GET', 'POST']));
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
        self::assertSame($allowed, self::allowsWithDefaultPatterns([['path' => $pattern, 'method' => null]], $route, ['GET']));
    }

    public function testALiteralSegmentIsNotAPattern(): void
    {
        self::assertFalse(self::allowsWithDefaultPatterns([['path' => '/up.json', 'method' => null]], '/upxjson', ['GET']));
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
            self::allowsWithDefaultPatterns([['path' => $pattern, 'method' => null]], $route, ['GET']);
        } finally {
            ini_set('pcre.jit', (string) $jit);
            ini_set('pcre.backtrack_limit', (string) $backtrackLimit);
        }
    }

    public function testANegatedClassExcludingASlashKeepsToOneSegment(): void
    {
        $allowsWith = static fn (string $pattern): bool => FrameworkRoutes::allows([['path' => '/files/*', 'method' => null]], '/files/{x}', static fn (string $name): ?string => $name === 'x' ? $pattern : null, ['GET'], self::noneOptional(...));

        self::assertTrue($allowsWith('[^/]+'), 'a class excluding the slash is not a catch-all');
        self::assertTrue($allowsWith('[^/.]+'));
        self::assertFalse($allowsWith('[^.]+'), 'a negated class that can take a slash is a catch-all');
    }

    public function testACatchAllRouteSegmentIsTakenByTwoStarsOnly(): void
    {
        $patternOf = static fn (string $name): ?string => $name === 'path' ? '.+' : null;
        $allows = static fn (string $pattern, string $route): bool => FrameworkRoutes::allows([['path' => $pattern, 'method' => null]], $route, $patternOf, ['GET'], self::noneOptional(...));

        self::assertFalse($allows('/files/*', '/files/{path}'), 'one star takes one segment, not a path');
        self::assertFalse($allows('/files/{path}', '/files/{path}'), 'a literal segment takes no catch-all');
        self::assertFalse($allows('/files/*/**', '/files/{path}'));
        self::assertFalse($allows('/*', '/{rest'), 'braces the check cannot read are a catch-all');
        self::assertTrue($allows('/files/**', '/files/{path}'));
        self::assertTrue($allows('/**', '/files/{path}/raw'));
        self::assertTrue($allows('/files/*', '/files/{page}'), 'the default pattern keeps to one segment');
    }

    public function testARouteWithAnOptionalTrailingPlaceholderIsAllowedOnlyWhenThePathWithoutItIsToo(): void
    {
        self::assertFalse(self::allowsWithOptionalIdPageAndFormat(['/c/*'], '/c/{id?}'), 'the route also serves /c, which one star does not take');
        self::assertTrue(self::allowsWithOptionalIdPageAndFormat(['/c/*', '/c'], '/c/{id?}'));
        self::assertTrue(self::allowsWithOptionalIdPageAndFormat(['/c/**'], '/c/{id}'), 'two stars take no segment too');
        self::assertFalse(self::allowsWithOptionalIdPageAndFormat(['/c/*/*', '/c/*'], '/c/{id}/{page}'), 'both trailing placeholders may be left out');
        self::assertTrue(self::allowsWithOptionalIdPageAndFormat(['/c/*/*', '/c/*', '/c'], '/c/{id}/{page}'));
        self::assertTrue(self::allowsWithOptionalIdPageAndFormat(['/c/*/*'], '/c/{id}/{other}'), 'a required placeholder after it keeps the optional one');
        self::assertFalse(self::allowsWithOptionalIdPageAndFormat(['/c.*'], '/c.{_format}'), 'the separator goes with the placeholder, so the route serves /c');
        self::assertTrue(self::allowsWithOptionalIdPageAndFormat(['/c/*'], '/c/{name}'), 'a required placeholder serves one segment only');
        self::assertTrue(self::allowsWithOptionalIdPageAndFormat(['/c/*'], '/c/{!id}'), 'Symfony never leaves out an important placeholder, default or not');
    }

    /**
     * @param list<array{path: string, method: ?string}> $frameworkRoutes
     * @param list<string> $methods
     */
    private static function allowsWithDefaultPatterns(array $frameworkRoutes, string $uri, array $methods): bool
    {
        return FrameworkRoutes::allows($frameworkRoutes, $uri, static fn (string $name): ?string => null, $methods, self::noneOptional(...));
    }

    /** @param list<string> $patterns */
    private static function allowsWithOptionalIdPageAndFormat(array $patterns, string $route): bool
    {
        return FrameworkRoutes::allows(
            array_map(static fn (string $pattern): array => ['path' => $pattern, 'method' => null], $patterns),
            $route,
            static fn (string $name): ?string => null,
            ['GET'],
            static fn (string $name): bool => in_array($name, ['id', 'page', '_format'], true),
        );
    }

    private static function noneOptional(string $name): bool
    {
        return false;
    }
}

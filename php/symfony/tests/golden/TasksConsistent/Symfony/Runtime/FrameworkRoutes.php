<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * The entry's `frameworkRoutes` allow-list as the boot check reads it (FR-25): an entry takes a route when its path
 * pattern matches the route's path (`*` one segment, `**` any number, a `*` inside a segment any characters but `/`,
 * an empty segment dropped on both sides) and it names no method, or the route's one method besides HEAD.
 */
final class FrameworkRoutes
{
    private const HEAD = 'HEAD';

    private function __construct()
    {
    }

    /**
     * Whether an entry of `$frameworkRoutes` takes the route at `$uri` answering `$methods`.
     *
     * @param list<array{path: string, method: ?string}> $frameworkRoutes
     * @param list<string> $methods
     */
    public static function allows(array $frameworkRoutes, string $uri, array $methods): bool
    {
        $methods = array_values(array_diff($methods, [self::HEAD]));
        foreach ($frameworkRoutes as $allowed) {
            $methodAllowed = $allowed['method'] === null || $methods === [$allowed['method']];
            if ($methodAllowed && self::pathMatches($allowed['path'], $uri)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether the route at `$uri` can serve a path at or under one of `$basePaths`: each of its first segments takes
     * the base path's (the same text, a placeholder or a catch-all), and it has as many segments, or a catch-all.
     * A placeholder segment is `{name}` or `{name?}`; one holding `*` (`{rest*}`, `**`) is a catch-all.
     *
     * @param list<string> $basePaths
     */
    public static function overlapsAny(array $basePaths, string $uri): bool
    {
        $routeSegments = self::segmentsOf($uri);
        foreach ($basePaths as $basePath) {
            if (self::overlaps($routeSegments, self::segmentsOf($basePath))) {
                return true;
            }
        }

        return false;
    }

    /**
     * The route path with each placeholder whose pattern takes a `/` written as the catch-all `{name*}`, as
     * `overlapsAny` reads it; `$patternOf` gives a placeholder's pattern, null for the framework's default one.
     *
     * @param \Closure(string): ?string $patternOf
     */
    public static function withCatchAlls(string $path, \Closure $patternOf): string
    {
        $segments = array_map(
            static function (string $segment) use ($patternOf): string {
                if (preg_match('#^\{!?(\w+)(?:<[^>]*>)?(?:\?[^}]*)?\}$#', $segment, $placeholder) !== 1) {
                    return $segment;
                }
                $pattern = $patternOf($placeholder[1]);

                return $pattern !== null && self::takesASlash($pattern) ? "{{$placeholder[1]}*}" : $segment;
            },
            explode('/', $path),
        );

        return implode('/', $segments);
    }

    // The app's router compiled the pattern already, so it reads as a regular expression.
    private static function takesASlash(string $pattern): bool
    {
        $matched = preg_match('#^(?:' . str_replace('#', '\\#', $pattern) . ')$#u', 'a/b');
        if ($matched === false) {
            throw new \LogicException("seampact: the route placeholder pattern '{$pattern}' could not be matched: " . preg_last_error_msg() . '.');
        }

        return $matched === 1;
    }

    /**
     * @param list<string> $routeSegments
     * @param list<string> $baseSegments
     */
    private static function overlaps(array $routeSegments, array $baseSegments): bool
    {
        foreach ($baseSegments as $index => $baseSegment) {
            $routeSegment = $routeSegments[$index] ?? null;
            if ($routeSegment === null) {
                return false;
            }
            if (str_contains($routeSegment, '*')) {
                return true;
            }
            if (!str_starts_with($routeSegment, '{') && $routeSegment !== $baseSegment) {
                return false;
            }
        }

        return true;
    }

    private static function pathMatches(string $path, string $uri): bool
    {
        $matched = preg_match(self::pathPattern($path), self::withoutEmptySegments($uri));
        if ($matched === false) {
            throw new \LogicException("seampact: the frameworkRoutes pattern '{$path}' could not be matched against the route '{$uri}': " . preg_last_error_msg() . "; write at most two '*' in a segment.");
        }

        return $matched === 1;
    }

    private static function pathPattern(string $path): string
    {
        $segments = array_map(
            static fn (string $segment): string => match ($segment) {
                '**' => '(?:/[^/]+)*',
                '*' => '/[^/]+',
                default => '/' . str_replace('\\*', '[^/]*', preg_quote($segment, '#')),
            },
            self::segmentsOf($path),
        );

        return '#^' . implode('', $segments) . '$#D';
    }

    // The root reads as the empty string, which `**` matches as it matches no segment.
    private static function withoutEmptySegments(string $uri): string
    {
        return implode('', array_map(static fn (string $segment): string => '/' . $segment, self::segmentsOf($uri)));
    }

    /**
     * The non-empty segments of a path, so `/a/`, `/a//b` and `/` read as `/a`, `/a/b` and no segment on both sides.
     *
     * @return list<string>
     */
    private static function segmentsOf(string $path): array
    {
        return array_values(array_filter(explode('/', $path), static fn (string $segment): bool => $segment !== ''));
    }
}

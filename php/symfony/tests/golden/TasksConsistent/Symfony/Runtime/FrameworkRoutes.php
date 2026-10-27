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

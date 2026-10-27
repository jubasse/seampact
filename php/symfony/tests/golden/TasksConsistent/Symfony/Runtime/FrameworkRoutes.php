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
    private const PLACEHOLDER = '#\{!?(\w+)(?:<[^>]*>)?(?:\?[^}]*)?\}#';
    private const UNREAD_CATCH_ALL = '{*}';
    // What a placeholder pattern may hold and still keep to one segment once `\d`, `\w` and `(?:` are read: letters,
    // digits, `_`, `-`, alternation, groups, quantifiers, anchors and classes.
    private const ONE_SEGMENT_PATTERN = '#^[A-Za-z0-9_|(){},?+*^$\[\]-]*$#D';
    private const CLASS_CONTENT = '#\[([^\]]*)\]#';

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
     * A segment holding a placeholder (`{name}`, `{name?}`, `api{rest}`) takes one segment; one holding `*`
     * (`{rest*}`, `**`) is a catch-all.
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
     * The route path with each segment that may take a `/` written as a catch-all, as `overlapsAny` reads it: one
     * holding a placeholder whose pattern does not keep to one segment (`{any}` with `.*`, `api{rest}` with `.+`)
     * becomes `{name*}`, and one whose braces do not read as placeholders `{*}`. `$patternOf` gives a placeholder's
     * pattern, null for the framework's default one, which keeps to one segment.
     *
     * @param \Closure(string): ?string $patternOf
     */
    public static function withCatchAlls(string $path, \Closure $patternOf): string
    {
        return implode('/', array_map(static fn (string $segment): string => self::scopedSegment($segment, $patternOf), explode('/', $path)));
    }

    /** @param \Closure(string): ?string $patternOf */
    private static function scopedSegment(string $segment, \Closure $patternOf): string
    {
        if (!str_contains($segment, '{') && !str_contains($segment, '}')) {
            return $segment;
        }

        preg_match_all(self::PLACEHOLDER, $segment, $placeholders);
        $outside = preg_replace(self::PLACEHOLDER, '', $segment);
        if ($placeholders[1] === [] || $outside === null || str_contains($outside, '{') || str_contains($outside, '}')) {
            return self::UNREAD_CATCH_ALL;
        }

        foreach ($placeholders[1] as $name) {
            $pattern = $patternOf($name);
            if ($pattern !== null && !self::keepsToOneSegment($pattern)) {
                return "{{$name}*}";
            }
        }

        return $segment;
    }

    // Read conservatively: a pattern keeps to one segment only when it holds no `.`, no `/`, no escape but `\d` and
    // `\w`, no negated class and no class range that can reach `/`.
    private static function keepsToOneSegment(string $pattern): bool
    {
        $withoutWordClasses = preg_replace('#\\\\[dw]#', '0', $pattern);
        if ($withoutWordClasses === null) {
            return false;
        }

        $read = str_replace('(?:', '(', $withoutWordClasses);
        if (str_contains($read, '[^') || preg_match(self::ONE_SEGMENT_PATTERN, $read) !== 1) {
            return false;
        }

        preg_match_all(self::CLASS_CONTENT, $read, $classes);
        foreach ($classes[1] as $content) {
            if (!self::classRangesKeepToAlphanumerics($content)) {
                return false;
            }
        }

        return true;
    }

    // A `-` inside a class is a range between two letters or digits, which never reaches `/`, or a literal at its edge.
    private static function classRangesKeepToAlphanumerics(string $content): bool
    {
        $last = strlen($content) - 1;
        for ($index = 1; $index < $last; $index++) {
            if ($content[$index] === '-' && (!ctype_alnum($content[$index - 1]) || !ctype_alnum($content[$index + 1]))) {
                return false;
            }
        }

        return true;
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
            if (!str_contains($routeSegment, '{') && $routeSegment !== $baseSegment) {
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

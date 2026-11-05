<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * The entry's `frameworkRoutes` allow-list as the boot check reads it (FR-25): an entry takes a route when its path
 * pattern matches the route's path (`*` one segment, `**` any number, a `*` inside a segment any characters but `/`,
 * an empty segment dropped on both sides) and it names no method, or the route's one method besides HEAD. A route
 * segment that may take a `/` is a catch-all, which only `**` takes. A route whose trailing placeholders are optional
 * also serves the path without them, which an entry must take too.
 */
final class FrameworkRoutes
{
    private const HEAD = 'HEAD';
    private const PLACEHOLDER = '#\{!?(\w+)(?:<[^>]*>)?(?:\?[^}]*)?\}#';
    private const TRAILING_PLACEHOLDER = '#\{(\w+)(?:<[^>]*>)?(?:\?[^}]*)?\}$#D';
    // The characters Symfony's route compiler leaves out with an optional placeholder they precede.
    private const OPTIONAL_PLACEHOLDER_SEPARATORS = '/,;.:-_~+*=@|';
    private const UNREAD_CATCH_ALL = '{*}';
    // A segment `withCatchAlls` writes as a catch-all: `{name*}` or `{*}`.
    private const CATCH_ALL_SEGMENT = '#^\{\w*\*\}$#D';
    private const ANY_SEGMENTS = '**';
    private const ONE_SEGMENT = '*';
    // What a placeholder pattern may hold and still keep to one segment once `\d`, `\w` and `(?:` are read: letters,
    // digits, `_`, `-`, alternation, groups, quantifiers, anchors and classes.
    private const ONE_SEGMENT_PATTERN = '#^[A-Za-z0-9_|(){},?+*^$\[\]-]*$#D';
    private const CLASS_CONTENT = '#\[([^\]]*)\]#';

    private function __construct()
    {
    }

    /**
     * Whether entries of `$frameworkRoutes` take the route at `$uri` answering `$methods`: every path it serves, the
     * one without its optional trailing placeholders included. The route is read through `withCatchAlls` with
     * `$patternOf`, so a segment that may take a `/` is a catch-all only `**` takes.
     *
     * @param list<array{path: string, method: ?string}> $frameworkRoutes
     * @param \Closure(string): ?string $patternOf
     * @param list<string> $methods
     * @param \Closure(string): bool $isOptional whether the route may be served without the placeholder
     */
    public static function allows(array $frameworkRoutes, string $uri, \Closure $patternOf, array $methods, \Closure $isOptional): bool
    {
        $methods = array_values(array_diff($methods, [self::HEAD]));
        foreach (self::servedPaths($uri, $isOptional) as $servedPath) {
            if (!self::anyEntryTakes($frameworkRoutes, self::segmentsOf(self::withCatchAlls($servedPath, $patternOf)), $methods)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param list<array{path: string, method: ?string}> $frameworkRoutes
     * @param list<string> $routeSegments
     * @param list<string> $methods
     */
    private static function anyEntryTakes(array $frameworkRoutes, array $routeSegments, array $methods): bool
    {
        foreach ($frameworkRoutes as $allowed) {
            $methodAllowed = $allowed['method'] === null || $methods === [$allowed['method']];
            if ($methodAllowed && self::segmentsMatch(self::segmentsOf($allowed['path']), 0, $routeSegments, 0, $allowed['path'])) {
                return true;
            }
        }

        return false;
    }

    /**
     * The route's path and each shorter one it also serves, as Symfony compiles a route (Laravel's `{id?}` included):
     * from the end, a placeholder that ends the path, is not important (`{!id}`) and `$isOptional` names may be left
     * out, with the separator before it, so `/c/{id?}` also serves `/c`.
     *
     * @param \Closure(string): bool $isOptional
     * @return list<string>
     */
    private static function servedPaths(string $path, \Closure $isOptional): array
    {
        $servedPaths = [$path];
        $remaining = $path;
        while (preg_match(self::TRAILING_PLACEHOLDER, $remaining, $placeholder, PREG_OFFSET_CAPTURE) === 1 && $isOptional($placeholder[1][0])) {
            $remaining = substr($remaining, 0, $placeholder[0][1]);
            if ($remaining !== '' && str_contains(self::OPTIONAL_PLACEHOLDER_SEPARATORS, substr($remaining, -1))) {
                $remaining = substr($remaining, 0, -1);
            }
            $servedPaths[] = $remaining;
        }

        return $servedPaths;
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
    // `\w`, no negated class but one that excludes `/` (`[^/]`, `[^/.]`) and no class range that can reach `/`.
    private static function keepsToOneSegment(string $pattern): bool
    {
        $withoutWordClasses = preg_replace('#\\\\[dw]#', '0', $pattern);
        if ($withoutWordClasses === null) {
            return false;
        }

        $withoutSlashExcludingClasses = preg_replace('#\[\^[^\]]*/[^\]]*\]#', '0', $withoutWordClasses);
        if ($withoutSlashExcludingClasses === null) {
            return false;
        }

        $read = str_replace('(?:', '(', $withoutSlashExcludingClasses);
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

    /**
     * Whether the entry's segments from `$entryIndex` take the route's segments from `$routeIndex`: `**` any number of
     * them, catch-alls included, and every other entry segment one segment that is not a catch-all.
     *
     * @param list<string> $entrySegments
     * @param list<string> $routeSegments
     */
    private static function segmentsMatch(array $entrySegments, int $entryIndex, array $routeSegments, int $routeIndex, string $path): bool
    {
        $entrySegment = $entrySegments[$entryIndex] ?? null;
        if ($entrySegment === null) {
            return $routeIndex === count($routeSegments);
        }

        if ($entrySegment === self::ANY_SEGMENTS) {
            for ($next = $routeIndex; $next <= count($routeSegments); $next++) {
                if (self::segmentsMatch($entrySegments, $entryIndex + 1, $routeSegments, $next, $path)) {
                    return true;
                }
            }

            return false;
        }

        $routeSegment = $routeSegments[$routeIndex] ?? null;
        if ($routeSegment === null || preg_match(self::CATCH_ALL_SEGMENT, $routeSegment) === 1) {
            return false;
        }

        return self::segmentMatches($entrySegment, $routeSegment, $path)
            && self::segmentsMatch($entrySegments, $entryIndex + 1, $routeSegments, $routeIndex + 1, $path);
    }

    private static function segmentMatches(string $entrySegment, string $routeSegment, string $path): bool
    {
        if ($entrySegment === self::ONE_SEGMENT) {
            return true;
        }

        $matched = preg_match('#^' . str_replace('\\*', '[^/]*', preg_quote($entrySegment, '#')) . '$#D', $routeSegment);
        if ($matched === false) {
            throw new \LogicException("seampact: the frameworkRoutes pattern '{$path}' could not be matched against the route segment '{$routeSegment}': " . preg_last_error_msg() . "; write at most two '*' in a segment.");
        }

        return $matched === 1;
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

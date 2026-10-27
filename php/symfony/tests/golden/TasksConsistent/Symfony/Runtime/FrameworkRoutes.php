<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * The entry's `frameworkRoutes` allow-list as the boot check reads it (FR-25): an entry takes a route when its path
 * pattern matches the route's path (`*` one segment, `**` any number, a `*` inside a segment any characters but `/`)
 * and it names no method, or the route's one method besides HEAD.
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
            if ($methodAllowed && preg_match(self::pathPattern($allowed['path']), $uri) === 1) {
                return true;
            }
        }

        return false;
    }

    private static function pathPattern(string $path): string
    {
        $segments = array_map(
            static fn (string $segment): string => match ($segment) {
                '**' => '(?:/[^/]+)*',
                '*' => '/[^/]+',
                default => '/' . str_replace('\\*', '[^/]*', preg_quote($segment, '#')),
            },
            array_slice(explode('/', $path), 1),
        );

        return '#^' . ($segments === [] ? '/' : implode('', $segments)) . '$#D';
    }
}

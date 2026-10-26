<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** A key path into a config value, member names and array indexes, printed as the Node CLI prints it. */
final class KeyPath
{
    private function __construct()
    {
    }

    /**
     * `targets[1].link.validators`.
     *
     * @param list<string|int> $path
     */
    public static function format(array $path): string
    {
        $text = '';

        foreach ($path as $index => $segment) {
            $text .= match (true) {
                is_int($segment) => "[{$segment}]",
                $index === 0 => $segment,
                default => ".{$segment}",
            };
        }

        return $text;
    }

    /** Whether the formatted `$path` is `$ancestor` or below it. */
    public static function isAtOrBelow(string $path, string $ancestor): bool
    {
        return $path === $ancestor || self::isBelow($path, $ancestor);
    }

    /** Whether the formatted `$path` is strictly below `$ancestor`. */
    public static function isBelow(string $path, string $ancestor): bool
    {
        if ($path === $ancestor) {
            return false;
        }

        return $ancestor === '' || str_starts_with($path, "{$ancestor}.") || str_starts_with($path, "{$ancestor}[");
    }
}

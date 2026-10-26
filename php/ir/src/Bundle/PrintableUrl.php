<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * A source URL as a diagnostic may print it, as `printable-url.ts`: the user name, the password, the query and the
 * fragment are dropped, since a token in them would land in CI logs. Text that is not an absolute URL with a host
 * (an scp-like git address, a path) is printed as written.
 */
final class PrintableUrl
{
    private function __construct()
    {
    }

    public static function of(string $text): string
    {
        if (preg_match('#^[A-Za-z][A-Za-z0-9+.-]*://#', $text) !== 1) {
            return $text;
        }

        $parts = parse_url($text);
        if ($parts === false || !isset($parts['scheme'], $parts['host'])) {
            return $text;
        }

        $port = isset($parts['port']) ? ":{$parts['port']}" : '';
        $path = ($parts['path'] ?? '') === '' ? '/' : $parts['path'];

        return strtolower($parts['scheme']) . '://' . strtolower($parts['host']) . $port . $path;
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * The raw request target as the client sent it: `REQUEST_URI` without its query, minus the front controller's base
 * path computed from the server variables, never from forwarded headers, which `TrustProxies` reads after the boundary.
 */
final class RawTarget
{
    private function __construct()
    {
    }

    public static function path(Request $request): string
    {
        $uri = $request->server->getString('REQUEST_URI');
        $query = strpos($uri, '?');
        $path = $query === false ? $uri : substr($uri, 0, $query);
        if (preg_match('#^[a-z][a-z0-9+.-]*://[^/]*#i', $path, $origin) === 1) {
            $path = substr($path, strlen($origin[0]));
        }

        $script = $request->server->getString('SCRIPT_NAME');
        if ($script !== '' && str_starts_with($path, $script)) {
            return self::rooted(substr($path, strlen($script)));
        }

        $directory = rtrim(str_replace('\\', '/', dirname($script)), '/');

        return $directory !== '' && str_starts_with($path, "{$directory}/") ? self::rooted(substr($path, strlen($directory))) : self::rooted($path);
    }

    public static function query(Request $request): string
    {
        return $request->server->getString('QUERY_STRING');
    }

    private static function rooted(string $path): string
    {
        return str_starts_with($path, '/') ? $path : "/{$path}";
    }
}

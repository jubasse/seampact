<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Request;

/**
 * The raw request target as the client sent it: `REQUEST_URI` without its query, minus the front controller's base
 * path computed from the server variables, never from forwarded headers, which `TrustProxies` reads after the boundary.
 */
final class RawTarget
{
    private const PREFLIGHT_METHOD = 'OPTIONS';

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

    /** What the hooks see of the request: its method, raw path, headers and client address. */
    public static function view(Request $request): RequestView
    {
        $headers = [];
        foreach ($request->headers->all() as $name => $values) {
            $headers[(string) $name] = array_values(array_filter($values, is_string(...)));
        }

        return new RequestView($request->getMethod(), self::path($request), $headers, $request->server->getString('REMOTE_ADDR') ?: null);
    }

    /** A CORS preflight, which the app's CORS handling answers after the boundary. */
    public static function isPreflight(Request $request): bool
    {
        return $request->getMethod() === self::PREFLIGHT_METHOD
            && $request->headers->has('Origin')
            && $request->headers->has('Access-Control-Request-Method');
    }

    private static function rooted(string $path): string
    {
        return str_starts_with($path, '/') ? $path : "/{$path}";
    }
}

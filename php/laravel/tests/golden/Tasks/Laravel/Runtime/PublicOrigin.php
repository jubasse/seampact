<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * The origin absolute URLs start with (`api.wire.urls: absolute`): a scheme, a host and an optional port, from the
 * app's configuration. The request's `Host` and forwarded headers are never read.
 */
final class PublicOrigin
{
    private const ABSOLUTE_URLS = 'absolute';
    private const SCHEMES = ['http', 'https'];

    private function __construct()
    {
    }

    public static function writesAbsoluteUrls(ApiContract $contract): bool
    {
        return Ir::string(Ir::map(Ir::map($contract->ir, 'api'), 'wire'), 'urls') === self::ABSOLUTE_URLS;
    }

    /** The configured origin under absolute URLs; null under relative ones, or when the boot check refuses it. */
    public static function of(ApiContract $contract, mixed $configured): ?string
    {
        if (!self::writesAbsoluteUrls($contract) || !is_string($configured) || self::problemOf($configured) !== null) {
            return null;
        }

        return $configured;
    }

    /** The boot check's problem with the origin set in `$setting`, when the api writes absolute URLs. */
    public static function bootProblem(ApiContract $contract, string $setting, mixed $configured): ?string
    {
        if (!self::writesAbsoluteUrls($contract)) {
            return null;
        }

        if ($configured === null || $configured === '') {
            return "the api writes absolute URLs ('api.wire.urls: absolute') and '{$setting}' is not set: set it to the origin clients call, such as https://api.example.com";
        }

        $problem = is_string($configured) ? self::problemOf($configured) : 'is not a string';
        if ($problem === null) {
            return null;
        }
        $shown = is_string($configured) ? $configured : get_debug_type($configured);

        return "'{$setting}' is '{$shown}', which {$problem}: set a scheme (http or https), a host and an optional port, such as https://api.example.com";
    }

    private static function problemOf(string $configured): ?string
    {
        $origin = parse_url($configured);
        if ($origin === false) {
            return 'is not a URI';
        }

        $scheme = $origin['scheme'] ?? null;
        if ($scheme === null || !in_array($scheme, self::SCHEMES, true)) {
            return 'has no http or https scheme';
        }
        if (($origin['host'] ?? '') === '') {
            return 'has no host';
        }
        if (isset($origin['user']) || isset($origin['pass'])) {
            return 'carries user info';
        }
        if (isset($origin['path']) || isset($origin['query']) || isset($origin['fragment']) || str_ends_with($configured, '?') || str_ends_with($configured, '#')) {
            return 'has a path, a query or a fragment (a trailing slash included)';
        }

        return null;
    }
}

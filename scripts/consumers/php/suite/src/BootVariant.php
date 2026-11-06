<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

/**
 * The boot variant a boot case starts the app with (`SEAMPACT_SUITE_BOOT_VARIANT`, ADR 0015 "Boot tests"); unset, the
 * app boots as configured. The `allow-listed-framework-route` variant starts the app built from
 * `seampact.allow-listed.config.yaml`, the `framework-route-check-off` ones that of `seampact.route-check-off.config.yaml`,
 * and `HOOK_CHECK_OFF_APP_VARIANTS` that of `seampact.hook-check-off.config.yaml`, whose `tasks` entry filters `health` out.
 */
final class BootVariant
{
    private const VARIABLE = 'SEAMPACT_SUITE_BOOT_VARIANT';
    private const VARIANTS = [
        'missing-authenticate-hook',
        'missing-decider',
        'missing-scope-resolver',
        'missing-handler',
        'unlisted-framework-route',
        'allow-listed-framework-route',
        'pattern-allow-listed-framework-route',
        'framework-route-check-off',
        'framework-route-check-off-missing-hook',
        'hook-check-off',
        'hook-check-off-unlisted-route',
        'filtered-out-handler',
        'mount-mismatch',
    ];
    private const HOOK_CHECK_OFF_APP_VARIANTS = ['hook-check-off', 'hook-check-off-unlisted-route', 'filtered-out-handler'];
    /** The framework prefix the `mount-mismatch` variant serves the `tasks` api under; its entry states no mount. */
    public const MISMATCHED_MOUNT = '/mounted';
    /** The framework route the `pattern-allow-listed-framework-route` variant serves, allow-listed by `/v1/patterned/**`. */
    public const PATTERNED_ROUTE = '/v1/patterned/one/two';

    private function __construct()
    {
    }

    public static function is(string $variant): bool
    {
        return self::current() === $variant;
    }

    /** Whether the app serves `GET /v1/unlisted`: under each variant that checks that route. */
    public static function servesUnlistedRoute(): bool
    {
        return in_array(self::current(), ['unlisted-framework-route', 'allow-listed-framework-route', 'framework-route-check-off', 'hook-check-off-unlisted-route'], true);
    }

    public static function servesPatternedRoute(): bool
    {
        return self::is('pattern-allow-listed-framework-route');
    }

    /** Whether the app serves the `tasks` api under `MISMATCHED_MOUNT`. */
    public static function mountsUnderMismatchedPrefix(): bool
    {
        return self::is('mount-mismatch');
    }

    /** Whether the app registers no authenticate hook for the identity `user`. */
    public static function leavesOutAuthenticateHook(): bool
    {
        return in_array(self::current(), ['missing-authenticate-hook', 'framework-route-check-off-missing-hook', 'hook-check-off'], true);
    }

    /** Whether the app binds no handler for the `health` operation: missing, or filtered out of the generated code. */
    public static function leavesOutHealthHandler(): bool
    {
        return self::is('missing-handler') || in_array(self::current(), self::HOOK_CHECK_OFF_APP_VARIANTS, true);
    }

    public static function current(): ?string
    {
        $variant = getenv(self::VARIABLE);
        if ($variant === false || $variant === '') {
            return null;
        }
        if (!in_array($variant, self::VARIANTS, true)) {
            throw new \UnexpectedValueException(self::VARIABLE . "='{$variant}' names no boot variant; use one of " . implode(', ', self::VARIANTS));
        }

        return $variant;
    }
}

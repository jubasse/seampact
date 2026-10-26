<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

/**
 * The boot variant a boot case starts the app with (`SEAMPACT_SUITE_BOOT_VARIANT`, ADR 0015 "Boot tests"); unset, the
 * app boots as configured. The allow-listed variant is the configured app built from `seampact.allow-listed.config.yaml`.
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
    ];

    private function __construct()
    {
    }

    public static function is(string $variant): bool
    {
        return self::current() === $variant;
    }

    public static function servesUnlistedRoute(): bool
    {
        return self::is('unlisted-framework-route') || self::is('allow-listed-framework-route');
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

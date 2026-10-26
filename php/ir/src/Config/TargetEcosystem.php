<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** The runner a target entry's `use` belongs to: the forms cannot be confused (ADR 0011). */
enum TargetEcosystem
{
    /** A Maven `group:artifact` coordinate: the Gradle and Maven plugins generate it. */
    case Maven;

    /** An npm package name: the Node CLI generates it. */
    case Npm;

    /** A Composer `vendor/name`: `vendor/bin/seampact` generates it. */
    case Composer;

    // npm names never hold a colon, and an unscoped npm name never holds a slash.
    public static function of(string $use): self
    {
        return match (true) {
            str_contains($use, ':') => self::Maven,
            !str_starts_with($use, '@') && !str_starts_with($use, '.') && str_contains($use, '/') => self::Composer,
            default => self::Npm,
        };
    }
}

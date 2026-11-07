<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * Refusing local sources on shared branches (ADR 0011): `allowLocal` in the config, true when absent, and the
 * environment variable `SEAMPACT_ALLOW_LOCAL`, whose `false` forces the refusal and whose other values never lift a
 * `false` the config holds. A local source is a `path` source, or a git bundle source naming a local repository.
 */
enum LocalSourcePolicy
{
    case Allow;
    case Refuse;

    public const ALLOW_LOCAL_VARIABLE = 'SEAMPACT_ALLOW_LOCAL';

    private const FORCED_REFUSAL = 'false';

    /** @param array<string, string> $environment */
    public static function of(?bool $configured, array $environment): self
    {
        return self::isForced($environment) || $configured === false ? self::Refuse : self::Allow;
    }

    /**
     * Which setting refuses local sources, for a message: the environment variable wins.
     *
     * @param array<string, string> $environment
     */
    public static function refusalReason(array $environment): string
    {
        return self::isForced($environment) ? self::ALLOW_LOCAL_VARIABLE . '=' . self::FORCED_REFUSAL : 'allowLocal: false';
    }

    /** @param array<string, string> $environment */
    private static function isForced(array $environment): bool
    {
        return ($environment[self::ALLOW_LOCAL_VARIABLE] ?? null) === self::FORCED_REFUSAL;
    }
}

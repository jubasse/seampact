<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

use Symfony\Component\DependencyInjection\ContainerBuilder;

/**
 * Whether a bundle configuration value comes from an `%env()%` placeholder, which only the run-time check can read:
 * the merge pass turns each one into an `env_<hash>` string, and resolving it gives the `%env()%` back.
 */
final class EnvValue
{
    private const ENV_PLACEHOLDER = '/%env\(/';

    public static function isPlaceholder(ContainerBuilder $container, mixed $value): bool
    {
        $resolved = $container->resolveEnvPlaceholders($value);

        return is_string($resolved) && preg_match(self::ENV_PLACEHOLDER, $resolved) === 1;
    }
}

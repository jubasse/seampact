<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The names of a route's placeholders on the PHP targets: each input property's name (`{taskId}`), so `route()`, a
 * route's parameters and model binding read it by name. Symfony's route compiler, which Laravel uses too, takes at
 * most 32 characters, so a longer name keeps a positional one (`{p2}` for the second placeholder), which the boundary
 * never reads.
 */
final class RoutePlaceholder
{
    public const MAX_LENGTH = 32;
    /** The requirement of every placeholder: one whole segment, as Symfony's default, so no app pattern narrows it. */
    public const SEGMENT_REQUIREMENT = '[^/]++';
    /** A path segment that is one whole placeholder, `{taskId}`. */
    public const PLACEHOLDER_SEGMENT = '/^\{[^{}\/]+\}$/D';
    private const POSITIONAL_PREFIX = 'p';

    private function __construct()
    {
    }

    /**
     * The placeholders of the path segments `$segments`, in path order, or null when a parameter yields no name
     * segment (refused with its input type).
     *
     * @param list<string> $segments
     * @return list<string>|null
     */
    public static function namesOf(array $segments): ?array
    {
        $named = [];
        foreach ($segments as $segment) {
            if (preg_match(self::PLACEHOLDER_SEGMENT, $segment) !== 1) {
                continue;
            }

            $name = PhpNames::memberIdentifier(substr($segment, 1, -1));
            if ($name === null) {
                return null;
            }
            $named[] = $name;
        }

        $placeholders = [];
        foreach ($named as $position => $name) {
            $placeholders[] = strlen($name) > self::MAX_LENGTH ? self::positionalName($position + 1, $named) : $name;
        }

        return $placeholders;
    }

    /** @param list<string> $named */
    private static function positionalName(int $ordinal, array $named): string
    {
        $placeholder = self::POSITIONAL_PREFIX . $ordinal;
        while (in_array($placeholder, $named, true)) {
            $placeholder = self::POSITIONAL_PREFIX . $placeholder;
        }

        return $placeholder;
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The name of a route placeholder on the PHP targets: the input property's name (`{taskId}`), so `route()`, a route's
 * parameters and model binding read it by name. Symfony's route compiler, which Laravel uses too, takes at most 32
 * characters, so a longer name is refused by name.
 */
final class RoutePlaceholder
{
    public const MAX_LENGTH = 32;
    public const TOO_LONG_RULE = 'path.parameter.long.unsupported';

    private function __construct()
    {
    }

    /** The placeholder of the path parameter `$parameter`, null when it yields no name segment (refused with its type). */
    public static function nameOf(string $parameter): ?string
    {
        return PhpNames::memberIdentifier($parameter);
    }

    public static function isTooLong(string $placeholder): bool
    {
        return strlen($placeholder) > self::MAX_LENGTH;
    }

    public static function tooLongMessage(string $parameter, string $placeholder): string
    {
        return "The path parameter '{$parameter}' gives the route placeholder '{$placeholder}', longer than the " . self::MAX_LENGTH . " characters the router's compiler accepts.";
    }

    public static function tooLongFix(): string
    {
        return 'Shorten the parameter name in the contract.';
    }
}

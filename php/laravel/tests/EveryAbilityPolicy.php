<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

/** A Policy that allows every ability, even one whose name is not a method name, such as a dotted right. */
final class EveryAbilityPolicy
{
    /** @param list<mixed> $arguments */
    public function __call(string $ability, array $arguments): bool
    {
        return true;
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * Picks the hook that serves a name among the registered ones (ADR 0012 "Registration and per-right overrides"): the
 * first decider naming the right or rule, else the first one naming `Decider::EVERY_NAME`; the first scope resolver of
 * the scope. A registered service of the wrong type is a `LogicException`, which the boundary answers with the api's 500.
 */
final class HookSelection
{
    private function __construct()
    {
    }

    public static function decider(HookLookup $hooks, ApiContract $contract, string $name): ?Decider
    {
        $everyName = null;
        foreach ($hooks->deciders($contract) as $decider) {
            if (!$decider instanceof Decider) {
                throw new \LogicException("seampact: a decider registered for the api '{$contract->api}' (" . get_debug_type($decider) . ') does not implement ' . Decider::class . '.');
            }
            if (in_array($name, $decider->names(), true)) {
                return $decider;
            }
            if ($everyName === null && in_array(Decider::EVERY_NAME, $decider->names(), true)) {
                $everyName = $decider;
            }
        }

        return $everyName;
    }

    public static function scopeResolver(HookLookup $hooks, ApiContract $contract, string $scope): ?ScopeResolver
    {
        foreach ($hooks->scopeResolvers($contract) as $resolver) {
            if ($resolver instanceof ScopeResolver && $resolver->scope() === $scope) {
                return $resolver;
            }
        }

        return null;
    }
}

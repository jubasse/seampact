<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Contracts\Container\Container;
use Seampact\Hooks\AuthenticateHook;

/**
 * The api's hooks as container bindings, resolved per request: an authenticate hook per identity bound to its
 * generated interface, the deciders and scope resolvers tagged with the provider's tags, and the optional
 * unexpected-error listener. A missing hook is a `LogicException`, which the boundary answers with the api's 500.
 */
final class Hooks
{
    private function __construct()
    {
    }

    public static function decidersTag(string $api): string
    {
        return "seampact.{$api}.deciders";
    }

    public static function scopeResolversTag(string $api): string
    {
        return "seampact.{$api}.scope-resolvers";
    }

    /** @return AuthenticateHook<AuthenticateCall> */
    public static function authenticateHook(Container $container, ApiContract $contract, string $identity): AuthenticateHook
    {
        $interface = Ir::string(Ir::map(Ir::map($contract->types, 'identities'), $identity), 'hook') ?? '';
        $hook = $container->bound($interface) ? $container->make($interface) : null;
        if (!$hook instanceof AuthenticateHook) {
            throw new \LogicException("seampact: the api '{$contract->api}' has no authenticate hook for the identity '{$identity}'; bind {$interface} in the container.");
        }

        /** @var AuthenticateHook<AuthenticateCall> $hook */
        return $hook;
    }

    public static function decider(Container $container, ApiContract $contract, string $name): ?Decider
    {
        $everyName = null;
        foreach (self::tagged($container, self::decidersTag($contract->api)) as $decider) {
            if (!$decider instanceof Decider) {
                continue;
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

    public static function scopeResolver(Container $container, ApiContract $contract, string $scope): ?ScopeResolver
    {
        foreach (self::tagged($container, self::scopeResolversTag($contract->api)) as $resolver) {
            if ($resolver instanceof ScopeResolver && $resolver->scope() === $scope) {
                return $resolver;
            }
        }

        return null;
    }

    public static function unexpectedErrorListener(Container $container, string $listenerInterface): ?UnexpectedErrorListener
    {
        if (!$container->bound($listenerInterface)) {
            return null;
        }
        $listener = $container->make($listenerInterface);

        return $listener instanceof UnexpectedErrorListener ? $listener : null;
    }

    /** @return iterable<mixed> */
    private static function tagged(Container $container, string $tag): iterable
    {
        return $container->tagged($tag);
    }
}

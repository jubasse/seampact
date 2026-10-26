<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Container\Container;
use Psr\Log\LoggerInterface;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\IdempotencyStore;

/**
 * The api's hooks as container bindings, resolved per request: an authenticate hook per identity bound to its
 * generated interface, the deciders and scope resolvers tagged with the provider's tags, the optional
 * unexpected-error listener and the app's logger. A missing hook is a `LogicException`, which the boundary answers
 * with the api's 500. Laravel's `AuthorizationException` (`Gate::authorize()`) is a decider's access denial.
 */
final class Hooks implements HookLookup, IdempotencyStoreLookup
{
    /** The tags are `TAG_PREFIX . <api> . <kind suffix>`; the generated provider builds its constants from these. */
    public const TAG_PREFIX = 'seampact.';
    public const DECIDERS_TAG_SUFFIX = '.deciders';
    public const SCOPE_RESOLVERS_TAG_SUFFIX = '.scope-resolvers';

    public function __construct(private readonly Container $container)
    {
    }

    public static function decidersTag(string $api): string
    {
        return self::TAG_PREFIX . $api . self::DECIDERS_TAG_SUFFIX;
    }

    public static function scopeResolversTag(string $api): string
    {
        return self::TAG_PREFIX . $api . self::SCOPE_RESOLVERS_TAG_SUFFIX;
    }

    /** @return AuthenticateHook<AuthenticateCall> */
    public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
    {
        $interface = Ir::string(Ir::map(Ir::map($contract->types, 'identities'), $identity), 'hook') ?? '';
        $hook = $this->container->bound($interface) ? $this->container->make($interface) : null;
        if (!$hook instanceof AuthenticateHook) {
            throw new \LogicException("seampact: the api '{$contract->api}' has no authenticate hook for the identity '{$identity}'; bind {$interface} in the container.");
        }

        /** @var AuthenticateHook<AuthenticateCall> $hook */
        return $hook;
    }

    /** @return iterable<mixed> */
    public function deciders(ApiContract $contract): iterable
    {
        return $this->container->tagged(self::decidersTag($contract->api));
    }

    /** @return iterable<mixed> */
    public function scopeResolvers(ApiContract $contract): iterable
    {
        return $this->container->tagged(self::scopeResolversTag($contract->api));
    }

    public function unexpectedErrorListener(): ?UnexpectedErrorListener
    {
        if (!$this->container->bound(UnexpectedErrorListener::class)) {
            return null;
        }

        $listener = $this->binding(UnexpectedErrorListener::class);
        if (!$listener instanceof UnexpectedErrorListener) {
            throw new \LogicException('seampact: the container binds ' . UnexpectedErrorListener::class . ' to ' . get_debug_type($listener) . '; bind it to a class implementing that interface.');
        }

        return $listener;
    }

    public function idempotencyStore(): ?IdempotencyStore
    {
        if (!$this->container->bound(IdempotencyStore::class)) {
            return null;
        }
        $store = $this->binding(IdempotencyStore::class);
        if (!$store instanceof IdempotencyStore) {
            throw new \LogicException('seampact: the container binds ' . IdempotencyStore::class . ' to ' . get_debug_type($store) . '; bind it to a class implementing that interface.');
        }

        return $store;
    }

    // What the app bound, of whatever type: the container's own signature assumes the bound class implements the id.
    private function binding(string $abstract): mixed
    {
        return $this->container->make($abstract);
    }

    public function logger(): LoggerInterface
    {
        return $this->container->make(LoggerInterface::class);
    }

    public function isAccessDenial(\Throwable $failure): bool
    {
        return $failure instanceof AuthorizationException;
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Container\Container;
use Psr\Log\LoggerInterface;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\IdempotencyStoreLookup;
use Seampact\Codegen\Runtime\Ir;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\IdempotencyStore;

/**
 * The api's hooks as container bindings, resolved per request: an authenticate hook per identity bound to its
 * generated interface, the deciders and scope resolvers tagged with the provider's tags, the optional
 * unexpected-error listener bound to the api's generated interface, the optional idempotency store bound under the
 * api's own key, and the app's logger. A missing hook is a
 * `LogicException`, which the boundary answers with the api's 500. Laravel's `AuthorizationException` (`Gate::authorize()`) is a decider's access denial, and one
 * with status 404 (`Response::denyAsNotFound()`) hides the record.
 */
final class Hooks implements HookLookup, IdempotencyStoreLookup
{
    /** The tags are `TAG_PREFIX . <api> . <kind suffix>`; the generated provider builds its constants from these. */
    public const TAG_PREFIX = 'seampact.';
    public const DECIDERS_TAG_SUFFIX = '.deciders';
    public const SCOPE_RESOLVERS_TAG_SUFFIX = '.scope-resolvers';
    public const IDEMPOTENCY_STORE_KEY_SUFFIX = '.idempotency-store';
    private const NOT_FOUND_STATUS = 404;

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

    /** The container key the app binds the api's idempotency store under. */
    public static function idempotencyStoreKey(string $api): string
    {
        return self::TAG_PREFIX . $api . self::IDEMPOTENCY_STORE_KEY_SUFFIX;
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

    public function unexpectedErrorListener(ApiContract $contract): ?UnexpectedErrorListener
    {
        $interface = Ir::string($contract->types, 'unexpectedErrorListener')
            ?? throw new \LogicException("seampact: the contract of api '{$contract->api}' names no unexpected-error listener interface; regenerate it.");
        if (!$this->container->bound($interface)) {
            return null;
        }

        $listener = $this->binding($interface);
        if (!$listener instanceof UnexpectedErrorListener || !$listener instanceof $interface) {
            throw new \LogicException("seampact: the container binds {$interface} to " . get_debug_type($listener) . '; bind it to a class implementing that interface.');
        }

        return $listener;
    }

    public function idempotencyStore(ApiContract $contract): ?IdempotencyStore
    {
        $key = self::idempotencyStoreKey($contract->api);
        if (!$this->container->bound($key)) {
            return null;
        }
        $store = $this->binding($key);
        if (!$store instanceof IdempotencyStore) {
            throw new \LogicException("seampact: the container binds '{$key}' to " . get_debug_type($store) . '; bind it to a class implementing ' . IdempotencyStore::class . '.');
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

    public function isNotFoundDenial(\Throwable $failure): bool
    {
        return $failure instanceof AuthorizationException && $failure->status() === self::NOT_FOUND_STATUS;
    }
}

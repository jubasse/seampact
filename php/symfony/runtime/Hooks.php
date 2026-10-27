<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Codegen\Runtime\Decider;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\IdempotencyStoreLookup;
use Seampact\Codegen\Runtime\Ir;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\IdempotencyStore;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/**
 * The api's hooks as tagged services, which the bundle autoconfigures from the hook interfaces: a service locator of
 * the authenticate hooks keyed by their generated interface, the deciders and scope resolvers as tagged iterators, the
 * optional unexpected-error listener of the api's generated interface and idempotency store, and the app's logger. A
 * missing hook is a `LogicException`, which the boundary answers with the api's 500. Symfony's `AccessDeniedException` (`denyAccessUnlessGranted()`) is a decider's access
 * denial, named as a string so an app without SecurityBundle still loads this class.
 */
#[Exclude]
final class Hooks implements HookLookup, IdempotencyStoreLookup
{
    /** The tags are `TAG_PREFIX . <api> . <kind suffix>`; the generated bundle builds its tags from these. */
    public const TAG_PREFIX = 'seampact.';
    public const AUTHENTICATE_TAG_SUFFIX = '.authenticate';
    public const DECIDERS_TAG_SUFFIX = '.deciders';
    public const SCOPE_RESOLVERS_TAG_SUFFIX = '.scope_resolvers';
    /** The tag attribute naming an authenticate hook's generated interface, the locator's key. */
    public const HOOK_ATTRIBUTE = 'hook';
    public const DECIDER_FIX = "register a service implementing the api's Decider and naming it, or '" . Decider::EVERY_NAME . "', with autoconfiguration on";
    public const AUTHENTICATE_HOOK_FIX = 'register one service implementing %s, with autoconfiguration on';
    public const SCOPE_RESOLVER_FIX = "register a service implementing the api's ScopeResolver, with autoconfiguration on";
    public const IDEMPOTENCY_STORE_FIX = 'alias ' . IdempotencyStore::class . ' to a service implementing it';
    private const ACCESS_DENIED = 'Symfony\\Component\\Security\\Core\\Exception\\AccessDeniedException';

    /**
     * @param iterable<mixed> $deciders
     * @param iterable<mixed> $scopeResolvers
     */
    public function __construct(
        private readonly ContainerInterface $authenticateHooks,
        private readonly iterable $deciders,
        private readonly iterable $scopeResolvers,
        private readonly mixed $unexpectedErrorListener,
        private readonly LoggerInterface $logger,
        private readonly mixed $idempotencyStore = null,
    ) {
    }

    public static function tag(string $api, string $suffix): string
    {
        return self::TAG_PREFIX . $api . $suffix;
    }

    /** @return AuthenticateHook<AuthenticateCall> */
    public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook
    {
        $interface = Ir::string(Ir::map(Ir::map($contract->types, 'identities'), $identity), 'hook') ?? '';
        $hook = $this->authenticateHooks->has($interface) ? $this->authenticateHooks->get($interface) : null;
        if (!$hook instanceof AuthenticateHook) {
            throw new \LogicException("seampact: the api '{$contract->api}' has no authenticate hook for the identity '{$identity}'; register one service implementing {$interface}, with autoconfiguration on.");
        }

        /** @var AuthenticateHook<AuthenticateCall> $hook */
        return $hook;
    }

    /** @return iterable<mixed> */
    public function deciders(ApiContract $contract): iterable
    {
        return $this->deciders;
    }

    /** @return iterable<mixed> */
    public function scopeResolvers(ApiContract $contract): iterable
    {
        return $this->scopeResolvers;
    }

    public function unexpectedErrorListener(ApiContract $contract): ?UnexpectedErrorListener
    {
        $listener = $this->unexpectedErrorListener;
        $interface = Ir::string($contract->types, 'unexpectedErrorListener')
            ?? throw new \LogicException("seampact: the contract of api '{$contract->api}' names no unexpected-error listener interface; regenerate it.");
        if ($listener === null || ($listener instanceof UnexpectedErrorListener && $listener instanceof $interface)) {
            return $listener;
        }

        throw new \LogicException("seampact: the service {$interface} is " . get_debug_type($listener) . '; alias it to a class implementing that interface.');
    }

    public function idempotencyStore(): ?IdempotencyStore
    {
        $store = $this->idempotencyStore;
        if ($store === null || $store instanceof IdempotencyStore) {
            return $store;
        }

        throw new \LogicException('seampact: the service ' . IdempotencyStore::class . ' is ' . get_debug_type($store) . '; ' . self::IDEMPOTENCY_STORE_FIX . '.');
    }

    public function logger(): LoggerInterface
    {
        return $this->logger;
    }

    public function isAccessDenial(\Throwable $failure): bool
    {
        return is_a($failure, self::ACCESS_DENIED);
    }

    // Symfony's `AccessDeniedException` carries no status; `#[IsGranted(statusCode: 404)]` throws an `HttpException` instead, which takes the `notFound` role.
    public function isNotFoundDenial(\Throwable $failure): bool
    {
        return false;
    }
}

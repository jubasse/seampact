<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;
use Seampact\Hooks\AuthenticateHook;

/**
 * The api's hooks as tagged services, which the bundle autoconfigures from the hook interfaces: a service locator of
 * the authenticate hooks keyed by their generated interface, the deciders and scope resolvers as tagged iterators, the
 * optional unexpected-error listener and the app's logger. A missing hook is a `LogicException`, which the boundary
 * answers with the api's 500. Symfony's `AccessDeniedException` (`denyAccessUnlessGranted()`) is a decider's access
 * denial, named as a string so an app without SecurityBundle still loads this class.
 */
final class Hooks implements HookLookup
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

    public function unexpectedErrorListener(): ?UnexpectedErrorListener
    {
        $listener = $this->unexpectedErrorListener;
        if ($listener === null || $listener instanceof UnexpectedErrorListener) {
            return $listener;
        }

        throw new \LogicException('seampact: the service ' . UnexpectedErrorListener::class . ' is ' . get_debug_type($listener) . '; alias it to a class implementing that interface.');
    }

    public function logger(): LoggerInterface
    {
        return $this->logger;
    }

    public function isAccessDenial(\Throwable $failure): bool
    {
        return is_a($failure, self::ACCESS_DENIED);
    }
}

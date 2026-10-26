<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Psr\Log\LoggerInterface;
use Seampact\Hooks\AuthenticateHook;

/**
 * Where the boundary finds the app's hooks and services, which each target answers from its own container: the
 * authenticate hook of an identity, the registered deciders and scope resolvers (HookSelection picks one), the optional
 * unexpected-error listener, the app's logger, and whether an exception a decider threw is the framework's own access
 * denial. A later capability gets its own interface, never a new method here.
 */
interface HookLookup
{
    /**
     * @return AuthenticateHook<AuthenticateCall>
     * @throws \LogicException no hook is registered for the identity, with the target's registration fix
     */
    public function authenticateHook(ApiContract $contract, string $identity): AuthenticateHook;

    /** @return iterable<mixed> every service registered as a decider of the api, in registration order */
    public function deciders(ApiContract $contract): iterable;

    /** @return iterable<mixed> every service registered as a scope resolver of the api, in registration order */
    public function scopeResolvers(ApiContract $contract): iterable;

    public function unexpectedErrorListener(): ?UnexpectedErrorListener;

    public function logger(): LoggerInterface;

    /** Whether `$failure`, thrown by a decider, is the framework's access denial, which answers the requirement's first denial code. */
    public function isAccessDenial(\Throwable $failure): bool;
}

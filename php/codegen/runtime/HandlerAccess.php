<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Seampact\Hooks\ResolvedScope;

/**
 * Who is calling, as the handler reads it (ADR 0012 "Open tenancy"): the principal and the scopes the boundary's
 * access step resolved for the api's request, read from its state. The principal reaches the handler as its schema
 * declares, in the identity's generated principal class; the scopes in the operation's generated scopes class.
 * Neither is part of the wire input.
 */
final class HandlerAccess
{
    private const INPUT_PRINCIPAL = 'inputPrincipal';
    private const INPUT_SCOPES = 'inputScopes';
    private const OPTIONAL_ACCESS = 'optional';

    private function __construct()
    {
    }

    /**
     * The caller's principal, null for an anonymous caller on an optional-auth route.
     *
     * @template T of object
     * @param string $operationId the operation of the class that reads it
     * @param class-string<T> $principalClass the generated principal class of the operation's identity
     * @return ?T
     */
    public static function principal(BoundaryState $state, string $operationId, string $principalClass): ?object
    {
        self::assertReadable($state, $operationId);
        if ($state->principal === null) {
            return null;
        }
        if ($state->principal instanceof $principalClass) {
            return $state->principal;
        }

        // Members the schema does not declare are dropped: the handler gets the generated class, built from the accessors.
        $identity = Ir::string(Ir::map($state->contract->operation($operationId), 'access'), 'identity')
            ?? throw new \LogicException("seampact: operation '{$operationId}' has no identity, so it has no principal; regenerate the code.");

        return new $principalClass(...PrincipalMembers::accessorValues($state->contract, $identity, $state->principal));
    }

    /**
     * The principal of a route that requires its identity.
     *
     * @template T of object
     * @param class-string<T> $principalClass
     * @return T
     */
    public static function authenticatedPrincipal(BoundaryState $state, string $operationId, string $principalClass): object
    {
        return self::principal($state, $operationId, $principalClass)
            ?? throw new \LogicException("seampact: operation '{$operationId}' requires its identity, but the boundary admitted it without a principal.");
    }

    /**
     * The scopes the operation runs in, outermost first, each as its resolver answered it.
     *
     * @template T of object
     * @param class-string<T> $scopesClass the operation's generated scopes class
     * @return T
     */
    public static function scopes(BoundaryState $state, string $operationId, string $scopesClass): object
    {
        self::assertReadable($state, $operationId);

        // The access step refuses a resolver answering another scope; this holds a state built another way to it.
        $declared = array_map(static fn (array $entry): string => Ir::string($entry, 'scope') ?? '', Ir::maps($state->contract->operation($operationId), 'scopes'));
        $resolved = array_map(static fn (ResolvedScope $scope): string => $scope->scope, $state->scopes);
        if ($declared !== $resolved) {
            throw new \LogicException("seampact: operation '{$operationId}' runs in the scopes " . implode(', ', $declared) . ', but the boundary resolved ' . (implode(', ', $resolved) ?: 'none') . '.');
        }

        return new $scopesClass(...$state->scopes);
    }

    /**
     * The members a target's generated input takes beside its wire parts, `principal` and `scopes`, when the contract
     * class says the operation's input carries them.
     *
     * @return array<string, ?object>
     */
    public static function inputMembers(BoundaryState $state): array
    {
        $types = $state->contract->operationTypes($state->operationId);
        $members = [];

        $principalClass = Ir::string($types, self::INPUT_PRINCIPAL);
        if ($principalClass !== null) {
            $optional = Ir::string(Ir::map($state->contract->operation($state->operationId), 'access'), 'kind') === self::OPTIONAL_ACCESS;
            $members['principal'] = $optional
                ? self::principal($state, $state->operationId, self::existingClass($principalClass))
                : self::authenticatedPrincipal($state, $state->operationId, self::existingClass($principalClass));
        }

        $scopesClass = Ir::string($types, self::INPUT_SCOPES);
        if ($scopesClass !== null) {
            $members['scopes'] = self::scopes($state, $state->operationId, self::existingClass($scopesClass));
        }

        return $members;
    }

    /** @return class-string */
    private static function existingClass(string $className): string
    {
        return class_exists($className) ? $className : throw new \LogicException("seampact: the contract class names the class {$className}, which is not loaded; regenerate the code.");
    }

    private static function assertReadable(BoundaryState $state, string $operationId): void
    {
        if ($state->operationId !== $operationId) {
            throw new \LogicException("seampact: operation '{$operationId}' read the boundary state of operation '{$state->operationId}'; read it on that operation's own route.");
        }
        if (!$state->admitted) {
            throw new \LogicException("seampact: the principal and scopes of operation '{$operationId}' were read before the boundary's access step admitted the request.");
        }
    }
}

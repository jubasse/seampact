<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The names a target gives the classes the boundary runtime reads (`ContractClass`, `IdentityTypes`): the
 * contract class, the class holding the route table, each identity's hook interface and credentials class, the
 * target's own entries in an operation's types, the api's unexpected-error listener interface, and the full name of
 * each runtime class the generated code imports.
 */
interface BoundaryNames
{
    public function layout(): ApiLayout;

    public function contractClass(): string;

    /** The class whose `DEFAULTS` and `ROUTES` constants the runtime's `ApiContract` reads. */
    public function routesClass(): string;

    /** @return array<string, array{hook: string, credentials: string, principal: string, principalMembers: string}> the hook interface, credentials class, principal class and principal members interface of each identity a kept operation reads */
    public function identities(): array;

    /** @return array<string, string> the target's own classes of a kept operation, appended to its types */
    public function operationClasses(string $operationId): array;

    /** The api's own `UnexpectedErrorListener` interface, the container key the runtime looks the app's listener up by. */
    public function unexpectedErrorListener(): string;

    /** The full name of the runtime class `$simpleName`, in the target's runtime namespace or the shared one. */
    public function runtime(string $simpleName): string;
}

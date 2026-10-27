<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Nette\PhpGenerator\Method;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\Operation;

/**
 * Who is calling, as each operation's handler reads it (ADR 0012 "Open tenancy"): the principal of the operation's
 * identity, in its generated principal class, nullable on an optional-auth route, and the scopes it runs in, in one
 * generated class per operation with one accessor per scope, each the resolver's `ResolvedScope`. A public route has
 * no principal and an unscoped one no scopes class. Neither is part of the wire input or its validation.
 */
final class HandlerAccessTypes
{
    public const INPUT_PRINCIPAL = 'inputPrincipal';
    public const INPUT_SCOPES = 'inputScopes';
    public const PRINCIPAL_MEMBER = 'principal';
    public const SCOPES_MEMBER = 'scopes';
    private const RESOLVED_SCOPE = 'Seampact\\Hooks\\ResolvedScope';

    public function __construct(private readonly BoundaryNames $names, private readonly Refusals $refusals)
    {
    }

    /** The generated principal class of the operation's identity, null on a public route. */
    public static function principalClass(BoundaryNames $names, Operation $operation): ?string
    {
        $access = $operation->access;
        $identity = $access instanceof IdentityAccess || $access instanceof OptionalAccess ? $access->identity : null;

        return $identity === null ? null : $names->identities()[$identity]['principal'] ?? null;
    }

    /** The principal's type: null for an anonymous caller on an optional-auth route, else always set. */
    public function principalType(Operation $operation, PhpClassFile $file): ?PhpType
    {
        $class = self::principalClass($this->names, $operation);
        if ($class === null) {
            return null;
        }
        $nullable = $operation->access instanceof OptionalAccess;

        return new PhpType($file->type($class), $file->name($class), $nullable);
    }

    /**
     * The members an input of placement `Input` takes beside its wire parts, as the contract class lists them for the
     * runtime, by role.
     *
     * @return array<string, string>
     */
    public static function inputTypes(BoundaryNames $names, Operation $operation): array
    {
        $types = [];
        $principal = self::principalClass($names, $operation);
        if ($principal !== null) {
            $types[self::INPUT_PRINCIPAL] = $principal;
        }
        $scopes = $names->layout()->operation($operation->id)?->scopes;
        if ($scopes !== null) {
            $types[self::INPUT_SCOPES] = $scopes;
        }

        return $types;
    }

    /** Promotes `principal` and `scopes` on the constructor of an input of placement `Input`. */
    public function promoteOnInput(Method $constructor, PhpClassFile $input, Operation $operation, OperationNames $names): void
    {
        $principal = $this->principalType($operation, $input);
        if ($principal !== null) {
            PhpTypes::promote($constructor, self::PRINCIPAL_MEMBER, $principal);
        }
        if ($names->scopes !== null) {
            PhpTypes::promote($constructor, self::SCOPES_MEMBER, new PhpType($input->type($names->scopes), $input->name($names->scopes)));
        }
    }

    /** The scopes class of an operation that runs in at least one scope, outermost first. */
    public function scopesFile(Operation $operation, OperationNames $names, IrPlace $at): ?PhpClassFile
    {
        if ($names->scopes === null) {
            return null;
        }

        $file = new PhpClassFile($names->scopes);
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly();
        $class->addComment("The scopes operation '{$operation->id}' runs in, outermost first, each as its scope resolver resolved it.");
        $constructor = $class->addMethod('__construct');
        $resolvedScope = $file->type(self::RESOLVED_SCOPE);

        $members = [];
        foreach ($operation->scopes as $index => $scope) {
            $scopeAt = $at->below('scopes', $index);
            $member = PhpNames::memberIdentifier($scope->scope);
            if ($member === null) {
                $this->refusals->inconsistent('scope.no-segment', "The scope '{$scope->scope}' yields no name segment", $scopeAt);
                continue;
            }
            $claimed = $members[strtolower($member)] ?? null;
            if ($claimed !== null) {
                $this->refusals->add('name.collision', "The accessor '{$member}()' would be written for both scopes '{$claimed}' and '{$scope->scope}' of operation '{$operation->id}'.", 'Rename one of the scopes in the contract.', $scopeAt);
                continue;
            }

            $members[strtolower($member)] = $scope->scope;
            $constructor->addPromotedParameter($member)->setPrivate()->setType($resolvedScope);
            $class->addMethod($member)->setPublic()->setReturnType($resolvedScope)
                ->addComment("The scope '{$scope->scope}': its id and the value its resolver loaded.")
                ->setBody("return \$this->{$member};");
        }

        return $file;
    }
}

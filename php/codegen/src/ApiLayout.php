<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\Name;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Naming\NameSource;
use Seampact\Ir\Naming\NamingRole;
use Seampact\Ir\Naming\SplitName;

/**
 * The framework-neutral PHP names of one api, computed once (ADR 0023 and 0024 "Placement"): the schema types under
 * `<namespace>\Schemas`, the operation, result, exception and endpoints types under `<namespace>`. A target claims
 * its own placement classes here too, so two classes taking one name are refused by name.
 */
final class ApiLayout implements TypeNames
{
    public readonly string $schemasNamespace;
    public readonly string $apiTypeName;
    public readonly string $contractException;

    /** @var array<string, string> */
    private array $schemaClasses = [];

    /** @var array<string, string> */
    private array $enumClasses = [];

    /** @var array<string, string> */
    private array $errorClasses = [];

    /** @var array<string, string> */
    private array $errorFactories = [];

    /** @var array<string, OperationNames> */
    private array $operationNames = [];

    /** @var array<string, string> each claimed class, lower-cased, and what claimed it */
    private array $claimed = [];

    public function __construct(public readonly ContractIR $ir, public readonly string $namespace, KeptForms $kept, private readonly Refusals $refusals)
    {
        $this->schemasNamespace = "{$namespace}\\Schemas";
        $this->apiTypeName = PhpNames::identifier($ir->api->name->segments, NamingRole::Schema);
        $this->contractException = $this->claim("{$namespace}\\{$this->apiTypeName}ContractException", "the api's contract exception base", IrPlace::root()->below('api', 'name'));

        foreach ($kept->enums() as $enumId => $enum) {
            $at = IrPlace::root()->below('enums', $enumId, 'name');
            $simpleName = $this->typeIdentifier($enum->name, $at);
            if ($simpleName !== null) {
                $this->enumClasses[$enumId] = $this->claim("{$this->schemasNamespace}\\{$simpleName}", "enum '{$enumId}'", $at);
            }
        }

        foreach ($kept->objects() as $schemaId => $schema) {
            $at = IrPlace::root()->below('schemas', $schemaId, 'name');
            $simpleName = $this->typeIdentifier($schema->name, $at);
            if ($simpleName !== null) {
                $this->schemaClasses[$schemaId] = $this->claim("{$this->schemasNamespace}\\{$simpleName}", "schema '{$schemaId}'", $at);
            }
        }

        foreach (array_keys($kept->errors()) as $code) {
            $at = IrPlace::root()->below('errors', $code);
            $segments = SplitName::segmentsOf($code, NameSource::Name);
            if ($segments === null) {
                $refusals->inconsistent('error.code.no-segment', "The error code '{$code}' yields no name segment", $at);
                continue;
            }
            $this->errorClasses[$code] = $this->claim($namespace . '\\' . PhpNames::identifier($segments, NamingRole::Error), "the exception of error '{$code}'", $at);
            $this->errorFactories[$code] = PhpNames::identifier($segments, NamingRole::Member);
        }

        $endpointsClaimed = [];
        foreach ($kept->operations() as [$index, $operation]) {
            $at = IrPlace::ofOperation($index, $operation->id);
            $owner = $this->endpointsOwner($operation);
            if ($owner === null) {
                $refusals->inconsistent('endpoints.owner.no-segment', "The operation '{$operation->id}' has no resource or surface that yields a name segment for its endpoints interface", $at->below('surface'));
                continue;
            }
            $names = $this->operationNamesOf($operation, $owner, $at->below('name'));
            $this->operationNames[$operation->id] = $names;
            if (!isset($endpointsClaimed[$names->endpoints])) {
                $endpointsClaimed[$names->endpoints] = true;
                $this->claim($names->endpoints, 'the endpoints interface ' . PhpClassFile::shortNameOf($names->endpoints), $at->below('name'));
            }
        }
    }

    public function schemaClass(string $schemaId): ?string
    {
        return $this->schemaClasses[$schemaId] ?? null;
    }

    public function enumClass(string $enumId): ?string
    {
        return $this->enumClasses[$enumId] ?? null;
    }

    public function errorClass(string $code): ?string
    {
        return $this->errorClasses[$code] ?? null;
    }

    public function errorFactory(string $code): ?string
    {
        return $this->errorFactories[$code] ?? null;
    }

    public function operation(string $operationId): ?OperationNames
    {
        return $this->operationNames[$operationId] ?? null;
    }

    /**
     * Claims `$className` for `$owner`, such as "the FormRequest of operation 'getTask'"; a class already claimed is
     * refused as `name.collision` at `$at`.
     */
    public function claim(string $className, string $owner, IrPlace $at): string
    {
        $key = strtolower($className);
        $previous = $this->claimed[$key] ?? null;
        if ($previous === null) {
            $this->claimed[$key] = $owner;
        } else {
            $this->refusals->add(
                'name.collision',
                "The PHP class '{$className}' would be written for both {$previous} and {$owner}.",
                "Rename one of them in the contract (a schema name, an operation's `operationId` or a property's `codeName`).",
                $at,
            );
        }

        return $className;
    }

    /** @param list<string> $owner */
    private function operationNamesOf(Operation $operation, array $owner, IrPlace $at): OperationNames
    {
        $segments = $operation->name->segments;
        $inRoot = fn (NamingRole $role): string => $this->claim($this->namespace . '\\' . PhpNames::identifier($segments, $role), "a type of operation '{$operation->id}'", $at);

        $responses = [];
        foreach ($operation->responses as $response) {
            $responses[$response->status] = $this->claim(
                $this->namespace . '\\' . PhpNames::identifier($segments, NamingRole::Response, $response->status),
                "the {$response->status} result of operation '{$operation->id}'",
                $at,
            );
        }

        return new OperationNames(
            method: PhpNames::identifier($segments, NamingRole::Operation),
            input: $inRoot(NamingRole::Input),
            path: $inRoot(NamingRole::Path),
            query: $inRoot(NamingRole::Query),
            headers: $inRoot(NamingRole::Headers),
            result: $this->claim($this->namespace . '\\' . PhpNames::identifier([...$segments, 'result'], NamingRole::Schema), "a type of operation '{$operation->id}'", $at),
            errors: $inRoot(NamingRole::Errors),
            endpoints: $this->namespace . '\\' . PhpNames::identifier($owner, NamingRole::Endpoints),
            responses: $responses,
            page: $operation->paging === null ? null : $this->claim($this->namespace . '\\' . PhpNames::identifier([...$segments, 'page'], NamingRole::Schema), "the page of operation '{$operation->id}'", $at),
            scopes: $operation->scopes === [] ? null : $this->claim($this->namespace . '\\' . PhpNames::identifier([...$segments, 'scopes'], NamingRole::Schema), "the scopes of operation '{$operation->id}'", $at),
        );
    }

    // A resource's operations share one interface; one without a resource joins its surface's, as on the Spring target.
    /** @return list<string>|null */
    private function endpointsOwner(Operation $operation): ?array
    {
        $resourceType = $operation->resource?->type;
        if ($resourceType !== null) {
            $segments = SplitName::segmentsOf($resourceType, NameSource::Name);
            if ($segments !== null && $segments !== []) {
                return $segments;
            }
        }

        $surface = $this->ir->api->surfaces[$operation->surface] ?? null;

        return $surface?->name->segments ?? SplitName::segmentsOf($operation->surface, NameSource::Name);
    }

    private function typeIdentifier(Name $name, IrPlace $at): ?string
    {
        $role = NamingRole::tryFrom($name->role->value);
        if ($role === null) {
            $this->refusals->unknownValue($at->below('role'), $name->role->value);

            return null;
        }

        try {
            return PhpNames::identifier($name->segments, $role, $name->status);
        } catch (\InvalidArgumentException $error) {
            $this->refusals->inconsistent('name.invalid', "The name is not one ADR 0007 builds an identifier from ({$error->getMessage()})", $at);

            return null;
        }
    }
}

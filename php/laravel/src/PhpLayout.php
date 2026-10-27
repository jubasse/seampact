<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\ApiLayout;
use Seampact\Codegen\BoundaryNames;
use Seampact\Codegen\IdentityTypes;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationNames;
use Seampact\Codegen\PhpNames;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RuntimeClasses;
use Seampact\Codegen\TypeNames;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Naming\NamingRole;

/**
 * Every PHP name the target writes for one api, computed once (ADR 0023 "Placement"): the shared names of
 * `ApiLayout`, the FormRequests beside each operation's input in the root namespace, then the Laravel placement under
 * `<namespace>\Laravel`, so a declared schema and a placement class never share a namespace, and the runtime classes
 * the code imports from `seampact/laravel` and `seampact/codegen`. Two classes taking one name are refused by name.
 */
final class PhpLayout implements TypeNames, BoundaryNames
{
    public readonly ApiLayout $api;
    public readonly ContractIR $ir;
    public readonly string $laravelNamespace;
    public readonly string $unexpectedErrorListener;
    public readonly string $routeTable;
    public readonly string $contract;
    public readonly string $boundary;
    public readonly string $accessMiddleware;
    public readonly string $serviceProvider;

    private const RUNTIME_NAMESPACE = 'Seampact\\Laravel\\Runtime';
    private const RUNTIME_DIRECTORY = __DIR__ . '/../runtime';

    private readonly RuntimeClasses $runtimeClasses;

    /** @var array<string, string> each kept operation's FormRequest */
    private array $requests = [];

    /** @var array<string, array{hook: string, credentials: string, principal: string, principalMembers: string}> each identity a kept operation reads */
    private array $identities = [];

    public function __construct(ContractIR $ir, public readonly string $namespace, KeptForms $kept, Refusals $refusals)
    {
        $this->api = new ApiLayout($ir, $namespace, $kept, $refusals);
        $this->ir = $ir;
        $this->laravelNamespace = "{$namespace}\\Laravel";
        $this->runtimeClasses = new RuntimeClasses(self::RUNTIME_NAMESPACE, self::RUNTIME_DIRECTORY);
        $apiName = IrPlace::root()->below('api', 'name');
        $this->routeTable = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}Routes", "the api's route table", $apiName);
        $this->contract = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}Contract", "the api's contract class", $apiName);
        $this->boundary = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}Boundary", "the api's boundary middleware", $apiName);
        $this->accessMiddleware = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}AccessMiddleware", "the api's access middleware", $apiName);
        $this->unexpectedErrorListener = $this->api->claim("{$this->laravelNamespace}\\UnexpectedErrorListener", "the api's unexpected-error listener interface", $apiName);
        $this->serviceProvider = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}SeampactServiceProvider", "the api's service provider", $apiName);

        foreach ($kept->operations() as [$index, $operation]) {
            if ($this->api->operation($operation->id) !== null) {
                $this->requests[$operation->id] = $this->api->claim(
                    $namespace . '\\' . PhpNames::identifier([...$operation->name->segments, 'request'], NamingRole::Schema),
                    "the FormRequest of operation '{$operation->id}'",
                    IrPlace::ofOperation($index, $operation->id)->below('name'),
                );
            }
        }
        $this->identities = IdentityTypes::claimed($this->api, $kept, $this->laravelNamespace);
    }

    public function layout(): ApiLayout
    {
        return $this->api;
    }

    public function contractClass(): string
    {
        return $this->contract;
    }

    public function routesClass(): string
    {
        return $this->routeTable;
    }

    /** @return array<string, string> the operation's FormRequest */
    public function operationClasses(string $operationId): array
    {
        return ['request' => $this->request($operationId)];
    }

    public function schemaClass(string $schemaId): ?string
    {
        return $this->api->schemaClass($schemaId);
    }

    public function enumClass(string $enumId): ?string
    {
        return $this->api->enumClass($enumId);
    }

    public function errorClass(string $code): ?string
    {
        return $this->api->errorClass($code);
    }

    public function operation(string $operationId): ?OperationNames
    {
        return $this->api->operation($operationId);
    }

    /** The FormRequest class of a kept operation. */
    public function request(string $operationId): string
    {
        return $this->requests[$operationId] ?? throw new \LogicException("The operation '{$operationId}' has no FormRequest name; it is not a kept operation with names.");
    }

    /** @return array<string, array{hook: string, credentials: string, principal: string, principalMembers: string}> the hook interface and credentials class of each identity a kept operation reads */
    public function identities(): array
    {
        return $this->identities;
    }

    public function unexpectedErrorListener(): string
    {
        return $this->unexpectedErrorListener;
    }

    public function runtime(string $simpleName): string
    {
        return $this->runtimeClasses->name($simpleName);
    }
}

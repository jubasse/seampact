<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\ApiLayout;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationNames;
use Seampact\Codegen\PhpNames;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\TypeNames;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Naming\NameSource;
use Seampact\Ir\Naming\NamingRole;
use Seampact\Ir\Naming\SplitName;

/**
 * Every PHP name the target writes for one api, computed once (ADR 0023 "Placement"): the shared names of
 * `ApiLayout`, then the Laravel placement under `<namespace>\Laravel` and the copied runtime under
 * `<namespace>\Laravel\Runtime`, so a declared schema and a placement class never share a namespace. Two classes
 * taking one name are refused by name.
 */
final class PhpLayout implements TypeNames
{
    public readonly ApiLayout $api;
    public readonly ContractIR $ir;
    public readonly string $laravelNamespace;
    public readonly string $runtimeNamespace;
    public readonly string $routeTable;
    public readonly string $contract;
    public readonly string $boundary;
    public readonly string $accessMiddleware;
    public readonly string $serviceProvider;

    /** @var array<string, string> each kept operation's FormRequest */
    private array $requests = [];

    /** @var array<string, array{hook: string, credentials: string, principal: string, principalMembers: string}> each identity a kept operation reads */
    private array $identities = [];

    public function __construct(ContractIR $ir, public readonly string $namespace, KeptForms $kept, Refusals $refusals)
    {
        $this->api = new ApiLayout($ir, $namespace, $kept, $refusals);
        $this->ir = $ir;
        $this->laravelNamespace = "{$namespace}\\Laravel";
        $this->runtimeNamespace = "{$namespace}\\Laravel\\Runtime";
        $apiName = IrPlace::root()->below('api', 'name');
        $this->routeTable = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}Routes", "the api's route table", $apiName);
        $this->contract = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}Contract", "the api's contract class", $apiName);
        $this->boundary = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}Boundary", "the api's boundary middleware", $apiName);
        $this->accessMiddleware = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}AccessMiddleware", "the api's access middleware", $apiName);
        $this->serviceProvider = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}SeampactServiceProvider", "the api's service provider", $apiName);

        foreach ($kept->operations() as [$index, $operation]) {
            if ($this->api->operation($operation->id) !== null) {
                $this->requests[$operation->id] = $this->api->claim(
                    $this->laravelNamespace . '\\' . PhpNames::identifier([...$operation->name->segments, 'request'], NamingRole::Schema),
                    "the FormRequest of operation '{$operation->id}'",
                    IrPlace::ofOperation($index, $operation->id)->below('name'),
                );
            }

            $identity = $operation->access instanceof IdentityAccess || $operation->access instanceof OptionalAccess ? $operation->access->identity : null;
            if ($identity !== null && !isset($this->identities[$identity])) {
                $this->identities[$identity] = $this->claimIdentity($identity, IrPlace::ofOperation($index, $operation->id)->below('access', 'identity'));
            }
        }
        ksort($this->identities);
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

    public function runtime(string $simpleName): string
    {
        return "{$this->runtimeNamespace}\\{$simpleName}";
    }

    /** @return array{hook: string, credentials: string, principal: string, principalMembers: string} */
    private function claimIdentity(string $identity, IrPlace $at): array
    {
        $segments = SplitName::segmentsOf($identity, NameSource::Name) ?? [$identity];

        return [
            'hook' => $this->api->claim($this->laravelNamespace . '\\' . PhpNames::identifier([...$segments, 'authenticate', 'hook'], NamingRole::Schema), "the authenticate hook of identity '{$identity}'", $at),
            'credentials' => $this->api->claim($this->laravelNamespace . '\\' . PhpNames::identifier([...$segments, 'credentials'], NamingRole::Schema), "the credentials of identity '{$identity}'", $at),
            'principal' => $this->api->claim($this->laravelNamespace . '\\' . PhpNames::identifier([...$segments, 'principal'], NamingRole::Schema), "the principal of identity '{$identity}'", $at),
            'principalMembers' => $this->api->claim($this->laravelNamespace . '\\' . PhpNames::identifier([...$segments, 'principal', 'members'], NamingRole::Schema), "the principal members interface of identity '{$identity}'", $at),
        ];
    }
}

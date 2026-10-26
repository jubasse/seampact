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
use Seampact\Ir\Naming\NamingRole;

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

    /** @var array<string, string> each kept operation's FormRequest */
    private array $requests = [];

    public function __construct(ContractIR $ir, public readonly string $namespace, KeptForms $kept, Refusals $refusals)
    {
        $this->api = new ApiLayout($ir, $namespace, $kept, $refusals);
        $this->ir = $ir;
        $this->laravelNamespace = "{$namespace}\\Laravel";
        $this->runtimeNamespace = "{$namespace}\\Laravel\\Runtime";
        $this->routeTable = $this->api->claim("{$this->laravelNamespace}\\{$this->api->apiTypeName}Routes", "the api's route table", IrPlace::root()->below('api', 'name'));

        foreach ($kept->operations() as [$index, $operation]) {
            if ($this->api->operation($operation->id) !== null) {
                $this->requests[$operation->id] = $this->api->claim(
                    $this->laravelNamespace . '\\' . PhpNames::identifier([...$operation->name->segments, 'request'], NamingRole::Schema),
                    "the FormRequest of operation '{$operation->id}'",
                    IrPlace::ofOperation($index, $operation->id)->below('name'),
                );
            }
        }
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

    public function runtime(string $simpleName): string
    {
        return "{$this->runtimeNamespace}\\{$simpleName}";
    }
}

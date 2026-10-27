<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\ApiLayout;
use Seampact\Codegen\BoundaryNames;
use Seampact\Codegen\IdentityTypes;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationNames;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\RouteHelpers;
use Seampact\Codegen\RuntimeClasses;
use Seampact\Ir\Model\Operation;

/**
 * The names of one api's Symfony placement (ADR 0024 "Placement"), claimed beside the shared names of `ApiLayout`:
 * its classes under `<namespace>\Symfony`, prefixed with the api's type name, the per-api attribute and hook
 * interfaces the app implements there, the runtime classes the code imports from `seampact/symfony` and
 * `seampact/codegen`, its routes (`seampact.<api id>.<operationId>`), and the api key that names its routing
 * resource and its bundle configuration (`seampact_<api key>`).
 */
final class SymfonyPlacement implements BoundaryNames
{
    public readonly string $namespace;
    public readonly string $symfonyNamespace;
    public readonly string $operationAttribute;
    public readonly string $decider;
    public readonly string $scopeResolver;
    public readonly string $unexpectedErrorListener;
    public readonly string $apiKey;
    public readonly string $bundle;
    public readonly string $controllerPass;
    public readonly string $routeLoader;
    public readonly string $inputResolver;
    public readonly string $settings;
    public readonly string $contract;
    public readonly string $boundary;
    public readonly string $access;
    public readonly string $configurationAlias;

    private const RUNTIME_NAMESPACE = 'Seampact\\Symfony\\Runtime';
    private const RUNTIME_DIRECTORY = __DIR__ . '/../runtime';

    private readonly RuntimeClasses $runtimeClasses;

    /** @var list<array{int, Operation}> */
    private array $operations = [];

    /** @var array<string, array{hook: string, credentials: string, principal: string, principalMembers: string}> */
    private array $identities;

    /** @var array<string, array{string, string}> each operation's input constraint and its validator */
    private array $inputConstraints = [];

    public function __construct(public readonly ApiLayout $layout, KeptForms $kept)
    {
        $this->namespace = $layout->namespace;
        $this->symfonyNamespace = "{$layout->namespace}\\Symfony";
        $this->runtimeClasses = new RuntimeClasses(self::RUNTIME_NAMESPACE, self::RUNTIME_DIRECTORY);
        $this->apiKey = self::apiKeyOf(...$layout->ir->api->name->segments);
        $this->configurationAlias = "seampact_{$this->apiKey}";

        $apiAt = IrPlace::root()->below('api', 'name');
        $placed = fn (string $suffix, string $owner): string => $layout->claim("{$this->symfonyNamespace}\\{$layout->apiTypeName}{$suffix}", $owner, $apiAt);
        $this->bundle = $placed('SeampactBundle', "the api's bundle");
        $this->controllerPass = $placed('ControllerPass', "the api's controller pass");
        $this->routeLoader = $placed('RouteLoader', "the api's route loader");
        $this->inputResolver = $placed('InputResolver', "the api's input resolver");
        $this->settings = $placed('Settings', "the api's settings");
        $this->contract = $placed('Contract', "the api's contract class");
        $this->boundary = $placed('Boundary', "the api's boundary subscriber");
        $this->access = $placed('Access', "the api's access table");
        // Unprefixed, as the runtime names them: the app implements them, one set per api.
        $unprefixed = fn (string $name, string $owner): string => $layout->claim("{$this->symfonyNamespace}\\{$name}", $owner, $apiAt);
        $this->operationAttribute = $unprefixed('SeampactOperation', "the api's operation attribute");
        $this->decider = $unprefixed('Decider', "the api's decider interface");
        $this->scopeResolver = $unprefixed('ScopeResolver', "the api's scope resolver interface");
        $this->unexpectedErrorListener = $unprefixed('UnexpectedErrorListener', "the api's unexpected-error listener interface");

        foreach ($kept->operations() as [$index, $operation]) {
            $names = $layout->operation($operation->id);
            if ($names === null) {
                continue;
            }
            $this->operations[] = [$index, $operation];
            $constraint = $this->symfonyNamespace . '\\' . PhpClassFile::shortNameOf($names->input) . 'Constraint';
            $at = IrPlace::ofOperation($index, $operation->id)->below('name');
            $this->inputConstraints[$operation->id] = [
                $layout->claim($constraint, "the input constraint of operation '{$operation->id}'", $at),
                $layout->claim("{$constraint}Validator", "the input constraint validator of operation '{$operation->id}'", $at),
            ];
        }
        $this->identities = IdentityTypes::claimed($layout, $kept, $this->symfonyNamespace);
    }

    public function layout(): ApiLayout
    {
        return $this->layout;
    }

    public function contractClass(): string
    {
        return $this->contract;
    }

    /** The route loader, which holds the route table and the run-time defaults. */
    public function routesClass(): string
    {
        return $this->routeLoader;
    }

    /** @return array<string, array{hook: string, credentials: string, principal: string, principalMembers: string}> */
    public function identities(): array
    {
        return $this->identities;
    }

    /** @return array<string, string> none: the Symfony placement adds no class per operation the runtime reads */
    public function operationClasses(string $operationId): array
    {
        return [];
    }

    /** The api key of an api name's segments: lower-case words joined by `_`. */
    public static function apiKeyOf(string ...$segments): string
    {
        return strtolower(implode('_', $segments));
    }

    /** @return list<array{int, Operation}> each kept operation with its index in the IR */
    public function operations(): array
    {
        return $this->operations;
    }

    public function names(string $operationId): OperationNames
    {
        return $this->layout->operation($operationId) ?? throw new \LogicException("The operation '{$operationId}' has no PHP names; it is not a kept operation.");
    }

    public function inputConstraint(string $operationId): string
    {
        return $this->constraintsOf($operationId)[0];
    }

    public function inputConstraintValidator(string $operationId): string
    {
        return $this->constraintsOf($operationId)[1];
    }

    /** Named by the api's id, as the boundary reads it (`ApiContract::routeName`), not by its routing resource key. */
    public function routeName(string $operationId): string
    {
        return RouteHelpers::routeName($this->layout->ir->api->id, $operationId);
    }

    public function unexpectedErrorListener(): string
    {
        return $this->unexpectedErrorListener;
    }

    public function runtime(string $simpleName): string
    {
        return $this->runtimeClasses->name($simpleName);
    }

    /** @return array{string, string} */
    private function constraintsOf(string $operationId): array
    {
        return $this->inputConstraints[$operationId] ?? throw new \LogicException("The operation '{$operationId}' has no input constraint; it is not a kept operation.");
    }
}

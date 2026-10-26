<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Symfony\Shared\OperationTypeNames;

/**
 * The names of one api's Symfony placement (ADR 0024 "Placement"): its classes under `<namespace>\Symfony`, prefixed
 * with the api's type name, the copied runtime under `<namespace>\Symfony\Runtime`, and the api key that names its
 * routes (`seampact.<api>.<operationId>`), its routing resource and its bundle configuration (`seampact_<api>`).
 */
final readonly class SymfonyPlacement
{
    public string $symfonyNamespace;
    public string $runtimeNamespace;
    public string $bundle;
    public string $controllerPass;
    public string $routeLoader;
    public string $inputResolver;
    public string $settings;
    public string $configurationAlias;

    public function __construct(public string $namespace, string $apiTypeName, public string $apiKey)
    {
        $this->symfonyNamespace = "{$namespace}\\Symfony";
        $this->runtimeNamespace = "{$namespace}\\Symfony\\Runtime";
        $this->bundle = "{$this->symfonyNamespace}\\{$apiTypeName}SeampactBundle";
        $this->controllerPass = "{$this->symfonyNamespace}\\{$apiTypeName}ControllerPass";
        $this->routeLoader = "{$this->symfonyNamespace}\\{$apiTypeName}RouteLoader";
        $this->inputResolver = "{$this->symfonyNamespace}\\{$apiTypeName}InputResolver";
        $this->settings = "{$this->symfonyNamespace}\\{$apiTypeName}Settings";
        $this->configurationAlias = "seampact_{$apiKey}";
    }

    /** The api key of an api name's segments: lower-case words joined by `_`. */
    public static function apiKeyOf(string ...$segments): string
    {
        return strtolower(implode('_', $segments));
    }

    public function inputConstraint(OperationTypeNames $names): string
    {
        return $this->symfonyNamespace . '\\' . ClassFile::shortNameOf($names->input) . 'Constraint';
    }

    public function inputConstraintValidator(OperationTypeNames $names): string
    {
        return $this->inputConstraint($names) . 'Validator';
    }

    public function routeName(string $operationId): string
    {
        return "seampact.{$this->apiKey}.{$operationId}";
    }

    public function runtime(string $simpleName): string
    {
        return "{$this->runtimeNamespace}\\{$simpleName}";
    }
}

<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

use Seampact\ApiPlatform\Runtime\ApiPlatformBoundarySubscriber;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Model\ContractIR;
use Seampact\Symfony\SymfonyFlavour;
use Seampact\Symfony\SymfonyPlacement;

/**
 * The API Platform flavour of the Symfony placement (ADR 0029 "Placement"): the boundary subscriber reads the operation
 * marker from the route, and the api adds its resources and processors, which its bundle registers.
 */
final class ApiPlatformFlavour implements SymfonyFlavour
{
    public const TARGET = 'api-platform';
    public const PACKAGE = 'seampact/api-platform';
    public const PROCESSOR_TAG = 'api_platform.state_processor';

    /** @var \WeakMap<SymfonyPlacement, ApiPlatformPlacement> */
    private \WeakMap $names;

    public function __construct()
    {
        $this->names = new \WeakMap();
    }

    public function target(): string
    {
        return self::TARGET;
    }

    public function package(): string
    {
        return self::PACKAGE;
    }

    public function boundaryParent(SymfonyPlacement $placement): string
    {
        return ApiPlatformBoundarySubscriber::class;
    }

    public function files(ContractIR $ir, SymfonyPlacement $placement, TargetOptions $options, Refusals $refusals, array $routePaths): array
    {
        $names = $this->namesOf($placement);
        $resources = new ResourceFile($names, $routePaths, $options->indentSpaces);
        $processors = new ProcessorFile($names);
        $files = [];

        foreach (array_keys($names->groups()) as $endpoints) {
            $files[] = $resources->file($endpoints);
        }

        foreach ($placement->operations() as [, $operation]) {
            $files[] = $processors->file($operation);
        }

        return $files;
    }

    public function bundleStatements(PhpClassFile $file, SymfonyPlacement $placement): string
    {
        $statements = [];
        foreach ($this->namesOf($placement)->processorClasses() as $processor) {
            $statements[] = '$services->set(' . $file->name($processor) . '::class)->autowire()->tag(' . var_export(self::PROCESSOR_TAG, true) . ');';
        }

        return implode("\n", $statements);
    }

    private function namesOf(SymfonyPlacement $placement): ApiPlatformPlacement
    {
        return $this->names[$placement] ??= new ApiPlatformPlacement($placement);
    }
}

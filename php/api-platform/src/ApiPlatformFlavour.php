<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

use Seampact\ApiPlatform\Runtime\ApiPlatformBoundarySubscriber;
use Seampact\ApiPlatform\Runtime\OperationMetadataCheck;
use Seampact\Codegen\BootCheckSwitches;
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
    public const MAIN_PROCESSOR = 'api_platform.state_processor.main';
    /** Between API Platform's write step (100) and its serialize step (200), where its object-mapper processor sits at 150. */
    public const REPLY_DECORATION_PRIORITY = 150;
    /** The controllers of API Platform's own routes (documentation, entrypoint, errors, context), which are framework routes. */
    private const OWN_ROUTE_CONTROLLERS = [
        'api_platform.action.documentation',
        'api_platform.action.entrypoint',
        'api_platform.action.not_exposed',
        'api_platform.jsonld.action.context',
    ];

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

    public function frameworkRouteControllers(): array
    {
        return self::OWN_ROUTE_CONTROLLERS;
    }

    public function files(ContractIR $ir, SymfonyPlacement $placement, TargetOptions $options, Refusals $refusals, array $routePaths): array
    {
        $names = $this->namesOf($placement);
        $resources = new ResourceFile($names, $routePaths, $options->indentSpaces);
        $processors = new ProcessorFile($names);
        $files = [(new ReplyDecoratorFile($names))->file()];

        foreach (array_keys($names->groups()) as $endpoints) {
            $files[] = $resources->file($endpoints);
        }

        foreach ($placement->operations() as [, $operation]) {
            $files[] = $processors->file($operation);
        }

        return $files;
    }

    public function bundleStatements(PhpClassFile $file, SymfonyPlacement $placement, ?BootCheckSwitches $bootCheck): string
    {
        $names = $this->namesOf($placement);
        $api = $names->placement->layout->ir->api->id;
        $statements = [$this->replyDecorator($file, $names)];
        foreach ($names->placement->operations() as [, $operation]) {
            $processor = $file->name($names->processorClass($operation->id));
            // A string id, since the app's resource import may hold the class's own id; API Platform finds the processor by its key.
            $statements[] = '$services->set(' . var_export("seampact.{$api}.processor.{$operation->id}", true) . ', ' . $processor . '::class)->autowire()->tag('
                . var_export(self::PROCESSOR_TAG, true) . ', [\'key\' => ' . $processor . '::class]);';
        }

        if ($bootCheck !== null) {
            $statements[] = $this->metadataCheck($file, $names);
        }

        return implode("\n", $statements);
    }

    private function replyDecorator(PhpClassFile $file, ApiPlatformPlacement $names): string
    {
        $api = $names->placement->layout->ir->api->id;

        return '$services->set(' . var_export("seampact.{$api}.reply_decorator", true) . ', ' . $file->name($names->replyDecoratorClass) . '::class)->decorate('
            . var_export(self::MAIN_PROCESSOR, true) . ', null, ' . self::REPLY_DECORATION_PRIORITY . ')->args([service(' . var_export("seampact.{$api}.reply_decorator.inner", true) . ')]);';
    }

    private function metadataCheck(PhpClassFile $file, ApiPlatformPlacement $names): string
    {
        $resources = array_map(fn (string $endpoints): string => $file->name($names->resourceClass($endpoints)) . '::class', array_keys($names->groups()));
        $processors = [];
        foreach ($names->placement->operations() as [, $operation]) {
            $processors[] = var_export($operation->id, true) . ' => ' . $file->name($names->processorClass($operation->id)) . '::class';
        }

        return '$services->set(' . var_export("seampact.{$names->placement->layout->ir->api->id}.metadata_check", true) . ', ' . $file->name(OperationMetadataCheck::class) . '::class)->autowire()->args([\'$api\' => '
            . var_export($names->placement->layout->ir->api->id, true)
            . ', \'$resourceClasses\' => [' . implode(', ', $resources) . '], \'$processors\' => [' . implode(', ', $processors) . ']])->tag(\'kernel.cache_warmer\');';
    }

    private function namesOf(SymfonyPlacement $placement): ApiPlatformPlacement
    {
        return $this->names[$placement] ??= new ApiPlatformPlacement($placement);
    }
}

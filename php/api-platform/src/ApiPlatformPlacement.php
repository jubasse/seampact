<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

use Seampact\Codegen\IrPlace;
use Seampact\Codegen\PhpClassFile;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Symfony\SymfonyPlacement;

/**
 * The names of one api's API Platform placement (ADR 0029 "Placement"), claimed beside the Symfony placement's under
 * `<namespace>\ApiPlatform`: one resource class per endpoints interface, named after its resource, and one processor
 * class per operation, named after the operation's input. The resource's short name is the item schema its success
 * responses name (the pack's `$resource`), else the resource's own name.
 */
final class ApiPlatformPlacement
{
    public readonly string $namespace;

    public readonly string $replyDecoratorClass;

    /** @var array<string, list<Operation>> each endpoints interface and the operations it serves */
    private array $groups = [];

    /** @var array<string, string> the resource class of each endpoints interface */
    private array $resources = [];

    /** @var array<string, string> the processor class of each operation id */
    private array $processors = [];

    public function __construct(public readonly SymfonyPlacement $placement)
    {
        $this->namespace = "{$placement->namespace}\\ApiPlatform";
        $layout = $placement->layout;
        $this->replyDecoratorClass = $layout->claim(
            "{$this->namespace}\\{$layout->apiTypeName}ReplyDecorator",
            "the api's reply decorator",
            IrPlace::root()->below('api', 'name'),
        );

        foreach ($placement->operations() as [$index, $operation]) {
            $names = $placement->names($operation->id);
            $at = IrPlace::ofOperation($index, $operation->id)->below('name');
            $this->groups[$names->endpoints][] = $operation;

            $this->resources[$names->endpoints] ??= $layout->claim(
                "{$this->namespace}\\" . self::groupName($names->endpoints) . 'Resource',
                "the API Platform resource of '{$names->endpoints}'",
                $at,
            );
            $processor = $this->namespace . '\\' . self::operationName($names->input) . 'Processor';
            $this->processors[$operation->id] = $layout->claim($processor, "the API Platform processor of operation '{$operation->id}'", $at);
        }
    }

    /** @return array<string, list<Operation>> */
    public function groups(): array
    {
        return $this->groups;
    }

    public function resourceClass(string $endpoints): string
    {
        return $this->resources[$endpoints] ?? throw new \LogicException("The endpoints interface '{$endpoints}' has no API Platform resource.");
    }

    public function processorClass(string $operationId): string
    {
        return $this->processors[$operationId] ?? throw new \LogicException("The operation '{$operationId}' has no API Platform processor.");
    }

    /** The API Platform short name of the resource that serves `$operations`. */
    public function shortName(string $endpoints): string
    {
        foreach ($this->groups[$endpoints] ?? [] as $operation) {
            foreach ($operation->responses as $response) {
                if ($response->status >= 200 && $response->status < 300 && $response->body instanceof RefTypeUse) {
                    return $response->body->schema;
                }
            }
        }

        return self::groupName($endpoints);
    }

    private static function groupName(string $endpoints): string
    {
        $short = PhpClassFile::shortNameOf($endpoints);

        return str_ends_with($short, 'Endpoints') ? substr($short, 0, -strlen('Endpoints')) : $short;
    }

    private static function operationName(string $inputClass): string
    {
        $short = PhpClassFile::shortNameOf($inputClass);

        return str_ends_with($short, 'Input') ? substr($short, 0, -strlen('Input')) : $short;
    }
}

<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

use Nette\PhpGenerator\Literal;
use Seampact\Codegen\PhpClassFile;
use Seampact\Ir\Model\Operation;

/**
 * One `#[ApiResource]` class of an api (ADR 0029 "Routes"): the operations of one endpoints interface, each an API
 * Platform operation whose metadata is written in full, so API Platform routes it under the contract's name, path and
 * operation marker, and runs the operation's generated processor with its own request handling off.
 */
final class ResourceFile
{
    private const RESOURCE_ATTRIBUTE = 'ApiPlatform\\Metadata\\ApiResource';
    private const LINK = 'ApiPlatform\\Metadata\\Link';
    private const PLACEHOLDER = '/\{([^{}]+)\}/';

    /**
     * @param array<string, string> $routePaths each routable operation's Symfony path, by operation id
     */
    public function __construct(
        private readonly ApiPlatformPlacement $names,
        private readonly array $routePaths,
        private readonly int $indentSpaces,
    ) {
    }

    public function file(string $endpoints): PhpClassFile
    {
        $file = new PhpClassFile($this->names->resourceClass($endpoints));
        $operations = [];
        foreach ($this->names->groups()[$endpoints] ?? [] as $operation) {
            $path = $this->routePaths[$operation->id] ?? null;
            if ($path !== null) {
                $operations[] = $this->operation($file, $operation, $path);
            }
        }

        $file->namespace->addClass($file->shortName)->setFinal()
            ->addComment("The API Platform resource of the contract's '{$this->names->shortName($endpoints)}' operations; API Platform routes them, the boundary serves them.")
            ->addAttribute($file->type(self::RESOURCE_ATTRIBUTE), [
                'shortName' => $this->names->shortName($endpoints),
                'operations' => new Literal("[\n" . implode(",\n", $operations) . ",\n{$this->indent(1)}]"),
            ]);

        return $file;
    }

    private function operation(PhpClassFile $file, Operation $operation, string $path): string
    {
        $placement = $this->names->placement;
        $method = $file->name(OperationSwitches::OPERATION_CLASSES[$operation->method->value]);
        $arguments = [
            'uriTemplate: ' . var_export($path, true),
            'name: ' . var_export($placement->routeName($operation->id), true),
            'defaults: [' . var_export(OperationSwitches::OPERATION_DEFAULT, true) . ' => ' . var_export($operation->id, true) . ']',
        ];
        $variables = $this->uriVariables($file, $path);
        if ($variables !== '') {
            $arguments[] = "uriVariables: [{$variables}]";
        }

        foreach (OperationSwitches::FLAGS as $flag => $value) {
            $arguments[] = "{$flag}: " . var_export($value, true);
        }

        $arguments[] = 'extraProperties: [' . implode(', ', array_map(
            static fn (string $key, bool $value): string => var_export($key, true) . ' => ' . var_export($value, true),
            array_keys(OperationSwitches::EXTRA_PROPERTIES),
            OperationSwitches::EXTRA_PROPERTIES,
        )) . ']';
        $arguments[] = 'processor: ' . $file->name($this->names->processorClass($operation->id)) . '::class';

        return "{$this->indent(2)}new {$method}(\n{$this->indent(3)}" . implode(",\n{$this->indent(3)}", $arguments) . ",\n{$this->indent(2)})";
    }

    private function indent(int $depth): string
    {
        return str_repeat(' ', $this->indentSpaces * $depth);
    }

    private function uriVariables(PhpClassFile $file, string $path): string
    {
        preg_match_all(self::PLACEHOLDER, $path, $matches);
        $link = $file->name(self::LINK);
        $resource = $file->shortName;

        return implode(', ', array_map(
            static fn (string $name): string => var_export($name, true) . " => new {$link}(parameterName: " . var_export($name, true) . ", fromClass: {$resource}::class, identifiers: [])",
            $matches[1],
        ));
    }
}

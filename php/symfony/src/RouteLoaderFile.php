<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\Literal;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RoutePlaceholder;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Model\Operation;

/**
 * The api's route loader (ADR 0024 "Routes"), tagged `routing.loader`: it serves the `seampact` type for its own api
 * key only and registers each operation as `seampact.<api>.<operationId>`, pointing at the endpoints interface's
 * method, with the operation id under `_seampact_operation`. Each placeholder is named after its input property
 * (`{taskId}`), so the router builds a URL by name, while the boundary reads the raw path. Per path depth a literal
 * segment comes before a placeholder, since the router matches in registration order. A static segment holding `{`, `}` or `?`, or one mixing a placeholder with text, is refused.
 */
final class RouteLoaderFile
{
    private const PLACEHOLDER = '/^\{[^{}\/]+\}$/D';
    private const PLACEHOLDER_INSIDE = '/\{[^{}\/]*\}/';
    private const ROUTE_SYNTAX_CHARACTERS = ['{', '}', '?'];

    public function __construct(
        private readonly SymfonyPlacement $placement,
        private readonly TargetOptions $options,
        private readonly Refusals $refusals,
    ) {
    }

    public function file(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->routeLoader);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->setExtends($file->type('Symfony\\Component\\Config\\Loader\\Loader'))
            ->addComment("The routes of the contract, imported once from the app's routing configuration:\n")
            ->addComment("    resource: {$this->placement->apiKey}\n    type: seampact");
        $class->addConstant('TYPE', 'seampact');
        $class->addConstant('RESOURCE', $this->placement->apiKey);
        $class->addConstant('OPERATION_DEFAULT', '_seampact_operation');
        $class->addConstant('DEFAULTS', [
            'responses' => $this->options->responses->value,
            'body_validation' => $this->options->bodyValidation,
            'framework_etag' => $this->options->frameworkEtag->value,
            'catch_all' => $this->options->catchAll,
        ])->addComment("The run-time defaults the entry's options set; the bundle configuration overrides `responses`.");

        $supports = $class->addMethod('supports')->setPublic()->setReturnType('bool');
        $supports->addParameter('resource')->setType('mixed');
        $supports->addParameter('type')->setType('?string')->setDefaultValue(null);
        $supports->setBody('return $type === self::TYPE && $resource === self::RESOURCE;');

        $table = [];
        foreach ($this->ordered() as [$path, $operation]) {
            $names = $this->placement->names($operation->id);
            $table[] = [
                'operation' => $operation->id,
                'method' => strtoupper($operation->method->value),
                'path' => $path,
                'name' => $this->placement->routeName($operation->id),
                'controller' => [new Literal($file->name($names->endpoints) . '::class'), $names->method],
            ];
        }
        $class->addConstant('ROUTES', $table)
            ->addComment('Each operation\'s route, literal segments first per path depth.')
            ->addComment('@var list<array{operation: string, method: string, path: string, name: string, controller: array{class-string, string}}>');

        $routeCollection = $file->name('Symfony\\Component\\Routing\\RouteCollection');
        $route = $file->name('Symfony\\Component\\Routing\\Route');
        $load = $class->addMethod('load')->setPublic()->setReturnType('Symfony\\Component\\Routing\\RouteCollection');
        $load->addParameter('resource')->setType('mixed');
        $load->addParameter('type')->setType('?string')->setDefaultValue(null);
        $load->setBody(<<<PHP
            \$routes = new {$routeCollection}();
            foreach (self::ROUTES as \$route) {
                \$defaults = ['_controller' => \$route['controller'][0] . '::' . \$route['controller'][1], self::OPERATION_DEFAULT => \$route['operation']];
                \$routes->add(\$route['name'], new {$route}(\$route['path'], \$defaults, methods: [\$route['method']]));
            }

            return \$routes;
            PHP);

        return $file;
    }

    /** @return list<array{string, Operation}> each operation's Symfony path, literal segments first per depth */
    private function ordered(): array
    {
        $routes = [];
        foreach ($this->placement->operations() as $position => [$index, $operation]) {
            $converted = $this->symfonyPath($operation, $index);
            if ($converted !== null) {
                $routes[] = [$converted[0], $operation, $converted[1], $position];
            }
        }

        usort($routes, static fn (array $first, array $second): int => [$first[2], $first[3]] <=> [$second[2], $second[3]]);

        return array_map(static fn (array $route): array => [$route[0], $route[1]], $routes);
    }

    /** @return array{string, list<int>}|null the path with named placeholders, and 1 per placeholder segment, 0 per literal */
    private function symfonyPath(Operation $operation, int $index): ?array
    {
        $segments = explode('/', $operation->path);
        $order = [];

        foreach ($segments as $position => $segment) {
            if (preg_match(self::PLACEHOLDER, $segment) === 1) {
                $placeholder = $this->placeholder($operation, $index, substr($segment, 1, -1));
                if ($placeholder === null) {
                    return null;
                }
                $segments[$position] = "{{$placeholder}}";
                $order[] = 1;
                continue;
            }

            if (preg_match(self::PLACEHOLDER_INSIDE, $segment) === 1) {
                $this->refuse($operation, $index, 'path.segment.mixed.unsupported', "The path segment '{$segment}' mixes a parameter with literal text, which the symfony target does not route, as on Laravel, Spring and the Node targets.", 'Give the parameter a segment of its own.');

                return null;
            }

            if (str_replace(self::ROUTE_SYNTAX_CHARACTERS, '', $segment) !== $segment) {
                $this->refuse($operation, $index, 'path.segment.literal.unsupported', "The static path segment '{$segment}' holds '{', '}' or '?', which Symfony's route syntax reads.", 'Remove those characters from the path.');

                return null;
            }

            $order[] = 0;
        }

        return [implode('/', $segments), $order];
    }

    // A parameter that yields no name is refused with its input type, so its route is only left out here.
    private function placeholder(Operation $operation, int $index, string $parameter): ?string
    {
        $placeholder = RoutePlaceholder::nameOf($parameter);
        if ($placeholder !== null && RoutePlaceholder::isTooLong($placeholder)) {
            $this->refuse($operation, $index, RoutePlaceholder::TOO_LONG_RULE, RoutePlaceholder::tooLongMessage($parameter, $placeholder), RoutePlaceholder::tooLongFix());

            return null;
        }

        return $placeholder;
    }

    private function refuse(Operation $operation, int $index, string $code, string $message, string $fix): void
    {
        $this->refusals->add($code, $message, $fix, IrPlace::ofOperation($index, $operation->id)->below('path'));
    }
}

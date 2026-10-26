<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\Literal;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Write\GeneratedFile;

/**
 * The contract routes of one api (ADR 0023 "Routes"): Laravel patterns with positional parameter names (`{p1}`), a
 * `:` in a static segment kept literal, registered per depth with literal segments before placeholders, since Laravel
 * matches in registration order. The route table class carries them and the option defaults for the `Route::seampact()`
 * macro; under `routes: file` a `routes.php` with one `Route::` line per operation is written beside it.
 */
final class RouteTable
{
    public const ROUTES_FILE = 'routes.php';
    private const ROUTE_FACADE = 'Illuminate\\Support\\Facades\\Route';
    private const LITERAL_SEGMENT = 0;
    private const PLACEHOLDER_SEGMENT = 1;

    /** @var list<array{operation: Operation, uri: string, depthKey: list<int>, names: OperationNames}> */
    private array $routes = [];

    public function __construct(private readonly PhpLayout $layout, private readonly LaravelOptions $options, private readonly Refusals $refusals)
    {
    }

    public function add(Operation $operation, OperationNames $names, IrPlace $at): void
    {
        $segments = [];
        $depthKey = [];
        $position = 0;

        foreach (explode('/', $operation->path) as $segment) {
            if (preg_match('/^\{[^{}\/]+\}$/D', $segment) === 1) {
                $position++;
                $segments[] = "{p{$position}}";
                $depthKey[] = self::PLACEHOLDER_SEGMENT;
                continue;
            }

            if (preg_match('/\{[^{}\/]+\}/', $segment) === 1) {
                $this->refusePath('path.segment.mixed', "The segment '{$segment}' mixes a placeholder with literal text, which Laravel's patterns do not read as the contract does", $at);

                return;
            }

            if (strpbrk($segment, '{}?') !== false) {
                $this->refusePath('path.segment.literal', "The static segment '{$segment}' holds '{', '}' or '?', which Laravel's patterns read as syntax", $at);

                return;
            }

            $segments[] = $segment;
            $depthKey[] = self::LITERAL_SEGMENT;
        }

        $this->routes[] = ['operation' => $operation, 'uri' => implode('/', $segments), 'depthKey' => $depthKey, 'names' => $names];
    }

    public function tableFile(): PhpClassFile
    {
        $file = new PhpClassFile($this->layout->routeTable);
        $class = $file->namespace->addClass($file->shortName)->setFinal();
        $class->addComment("The contract routes of api '{$this->layout->ir->api->id}', in registration order.");
        $class->addConstant('API', $this->layout->ir->api->id)->setPublic();
        $class->addConstant('DEFAULTS', [
            'responses' => $this->options->responses->value,
            'body_validation' => $this->options->bodyValidation,
            'framework_etag' => $this->options->frameworkEtag->value,
            'catch_all' => $this->options->catchAll,
        ])->setPublic()->addComment("The run-time defaults the entry's options set, which `config('seampact.<api>.*')` overrides.");

        $lines = [];
        foreach ($this->ordered() as $route) {
            $names = $route['names'];
            $operation = $route['operation'];
            $lines[] = "\t[\n"
                . "\t\t'operation' => " . var_export($operation->id, true) . ",\n"
                . "\t\t'method' => " . var_export(strtoupper($operation->method->value), true) . ",\n"
                . "\t\t'uri' => " . var_export($route['uri'], true) . ",\n"
                . "\t\t'name' => " . var_export($this->routeName($operation), true) . ",\n"
                . "\t\t'access' => " . var_export($operation->access->tag(), true) . ",\n"
                . "\t\t'action' => [" . $file->name($names->endpoints) . '::class, ' . var_export($names->method, true) . "],\n"
                . "\t],";
        }
        $class->addConstant('ROUTES', new Literal($lines === [] ? '[]' : "[\n" . implode("\n", $lines) . "\n]"))->setPublic()
            ->addComment('@var list<array{operation: string, method: string, uri: string, name: string, access: string, action: array{class-string, string}}>');

        $route = $file->name(self::ROUTE_FACADE);
        $class->addMethod('register')->setStatic()->setReturnType('void')
            ->addComment('Registers every contract route, in order, inside the caller\'s route group.')
            ->setBody("foreach (self::ROUTES as \$route) {\n\t{$route}::match([\$route['method']], \$route['uri'], \$route['action'])->name(\$route['name']);\n}");

        return $file;
    }

    /** The `routes.php` the app requires from its own routes file, or null under `routes: macro`. */
    public function routesFile(): ?GeneratedFile
    {
        if ($this->options->routes !== RoutesForm::File) {
            return null;
        }

        $imports = [self::ROUTE_FACADE => true];
        $lines = [];
        foreach ($this->ordered() as $route) {
            $names = $route['names'];
            $imports[$names->endpoints] = true;
            $lines[] = 'Route::' . $route['operation']->method->value . '(' . var_export($route['uri'], true) . ', ['
                . PhpClassFile::shortNameOf($names->endpoints) . '::class, ' . var_export($names->method, true) . '])->name('
                . var_export($this->routeName($route['operation']), true) . ');';
        }

        $imports = array_keys($imports);
        sort($imports);
        $text = "<?php\n\ndeclare(strict_types=1);\n\n"
            . implode('', array_map(static fn (string $import): string => "use {$import};\n", $imports))
            . "\n// The contract routes of api '{$this->layout->ir->api->id}'; require this file inside the route group that serves them.\n"
            . implode("\n", $lines) . "\n";

        return new GeneratedFile(self::ROUTES_FILE, $text);
    }

    private function routeName(Operation $operation): string
    {
        return "seampact.{$this->layout->ir->api->id}.{$operation->id}";
    }

    /** @return list<array{operation: Operation, uri: string, depthKey: list<int>, names: OperationNames}> */
    private function ordered(): array
    {
        $routes = $this->routes;
        usort($routes, static fn (array $first, array $second): int => $first['depthKey'] <=> $second['depthKey']);

        return $routes;
    }

    private function refusePath(string $form, string $description, IrPlace $at): void
    {
        $this->refusals->add("{$form}.unsupported", "{$description}.", "Give the segment its own path parameter, or rename it without '{', '}' or '?'.", $at->below('path'));
    }
}

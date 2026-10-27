<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\Dumper;
use Nette\PhpGenerator\Literal;
use Seampact\Codegen\AccessKind;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\OperationNames;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RoutePlaceholder;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Write\GeneratedFile;

/**
 * The contract routes of one api (ADR 0023 "Routes"): Laravel patterns with each placeholder named after its input
 * property (`{taskId}`, a name over 32 characters a positional `{p2}`) and pinned to one whole segment, so an app's
 * global `Route::pattern` never narrows it, a `:` in a static segment kept literal, registered per depth with literal
 * segments before placeholders, since Laravel matches in registration order. The route table class carries them and
 * the option defaults for the `Route::seampact()` macro; under `routes: file` a `routes.php` with one `Route::` line
 * per operation is written beside it. Each route
 * carries the access middleware, then the app's list for its access kind (`config('seampact.<api>.middleware.<kind>')`).
 * A route that reads no cookie credential (a bearer, header or signed caller, or a public one) is registered without
 * the CSRF middleware, so a `web` group never refuses a client that cannot hold its token; the boundary still checks
 * the contract's CSRF header for a cookie-only caller.
 */
final class RouteTable
{
    public const ROUTES_FILE = 'routes.php';
    public const CONFIG_FILE = 'config.php';
    private const PUBLIC_ORIGIN = 'public_origin';
    private const ROUTE_FACADE = 'Illuminate\\Support\\Facades\\Route';
    // The CSRF middleware of the `web` group, which only a cookie credential needs (ADR 0013).
    private const FORGERY_MIDDLEWARE = 'Illuminate\\Foundation\\Http\\Middleware\\PreventRequestForgery';
    private const LITERAL_SEGMENT = 0;
    private const PLACEHOLDER_SEGMENT = 1;
    private const KIND_MIDDLEWARE = 'KindMiddleware';

    /** @var list<array{operation: Operation, uri: string, placeholders: list<string>, depthKey: list<int>, names: OperationNames}> */
    private array $routes = [];

    public function __construct(private readonly PhpLayout $layout, private readonly LaravelOptions $options, private readonly Refusals $refusals)
    {
    }

    public function add(Operation $operation, OperationNames $names, IrPlace $at): void
    {
        $segments = [];
        $depthKey = [];
        $pathSegments = explode('/', $operation->path);
        // A parameter that yields no name is refused with its input type, so its route is only left out here.
        $placeholders = RoutePlaceholder::namesOf($pathSegments);
        if ($placeholders === null) {
            return;
        }
        $unplaced = $placeholders;

        foreach ($pathSegments as $segment) {
            if (preg_match(RoutePlaceholder::PLACEHOLDER_SEGMENT, $segment) === 1) {
                $segments[] = '{' . array_shift($unplaced) . '}';
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

        $this->routes[] = ['operation' => $operation, 'uri' => implode('/', $segments), 'placeholders' => $placeholders, 'depthKey' => $depthKey, 'names' => $names];
    }

    public function tableFile(): PhpClassFile
    {
        $file = new PhpClassFile($this->layout->routeTable);
        $class = $file->namespace->addClass($file->shortName)->setFinal();
        $class->addComment("The contract routes of api '{$this->layout->ir->api->id}', in registration order.");
        $class->addConstant('API', $this->layout->ir->api->id)->setPublic();
        $class->addConstant('DEFAULTS', [...$this->defaults(), 'middleware' => array_fill_keys(AccessKind::ALL, [])])->setPublic()->addComment("The run-time defaults the entry's options set, which `config('seampact.<api>.*')` overrides.");

        $lines = [];
        foreach ($this->ordered() as $route) {
            $names = $route['names'];
            $operation = $route['operation'];
            $lines[] = "\t[\n"
                . "\t\t'operation' => " . var_export($operation->id, true) . ",\n"
                . "\t\t'method' => " . var_export(strtoupper($operation->method->value), true) . ",\n"
                . "\t\t'uri' => " . var_export($route['uri'], true) . ",\n"
                . "\t\t'placeholders' => " . (new Dumper())->dump($route['placeholders']) . ",\n"
                . "\t\t'name' => " . var_export($this->routeName($operation), true) . ",\n"
                . "\t\t'access' => " . var_export($operation->access->tag(), true) . ",\n"
                . (AccessKind::isSigned($this->layout->ir, $operation) ? "\t\t'signed' => true,\n" : '')
                . ($this->skipsForgeryCheck($operation) ? "\t\t'cookieless' => true,\n" : '')
                . "\t\t'action' => [" . $file->name($names->endpoints) . '::class, ' . var_export($names->method, true) . "],\n"
                . "\t],";
        }
        $class->addConstant('ROUTES', new Literal($lines === [] ? '[]' : "[\n" . implode("\n", $lines) . "\n]"))->setPublic()
            ->addComment('@var list<array{operation: string, method: string, uri: string, placeholders: list<string>, name: string, access: string, signed?: true, cookieless?: true, action: array{class-string, string}}>');

        $route = $file->name(self::ROUTE_FACADE);
        $access = $file->name($this->layout->accessMiddleware);
        $kindMiddleware = $file->name($this->layout->runtime(self::KIND_MIDDLEWARE));
        $anySigned = array_filter($this->routes, fn (array $kept): bool => AccessKind::isSigned($this->layout->ir, $kept['operation'])) !== [];
        $kind = $anySigned ? "(\$route['signed'] ?? false) ? " . var_export(AccessKind::SIGNED, true) . " : \$route['access']" : "\$route['access']";
        $registration = "{$route}::match([\$route['method']], \$route['uri'], \$route['action'])->name(\$route['name'])"
            . "->where(array_fill_keys(\$route['placeholders'], " . var_export(RoutePlaceholder::SEGMENT_REQUIREMENT, true) . '))'
            . "->middleware([{$access}::class, ...{$kindMiddleware}::of(self::API, {$kind})]);";
        $anyCookieless = array_filter($this->routes, fn (array $kept): bool => $this->skipsForgeryCheck($kept['operation'])) !== [];
        $body = $anyCookieless
            ? "\t\$registered = {$registration}\n\tif (\$route['cookieless'] ?? false) {\n\t\t\$registered->withoutMiddleware(" . $file->name(self::FORGERY_MIDDLEWARE) . "::class);\n\t}\n"
            : "\t{$registration}\n";
        $class->addMethod('register')->setStatic()->setReturnType('void')
            ->addComment('Registers every contract route, in order, inside the caller\'s route group, each behind the access middleware and the app\'s list for its access kind.')
            ->setBody("foreach (self::ROUTES as \$route) {\n{$body}}");

        return $file;
    }

    /** The `routes.php` the app requires from its own routes file, or null under `routes: macro`. */
    public function routesFile(): ?GeneratedFile
    {
        if ($this->options->routes !== RoutesForm::File) {
            return null;
        }

        $kindMiddlewareClass = $this->layout->runtime(self::KIND_MIDDLEWARE);
        $imports = [self::ROUTE_FACADE => true, $this->layout->accessMiddleware => true, $kindMiddlewareClass => true];
        $access = PhpClassFile::shortNameOf($this->layout->accessMiddleware);
        $kindMiddleware = PhpClassFile::shortNameOf($kindMiddlewareClass);
        $api = var_export($this->layout->ir->api->id, true);
        $lines = [];
        foreach ($this->ordered() as $route) {
            $names = $route['names'];
            $imports[$names->endpoints] = true;
            $lines[] = 'Route::' . $route['operation']->method->value . '(' . var_export($route['uri'], true) . ', ['
                . PhpClassFile::shortNameOf($names->endpoints) . '::class, ' . var_export($names->method, true) . '])->name('
                . var_export($this->routeName($route['operation']), true) . ')' . self::segmentRequirements($route['placeholders']) . "->middleware([{$access}::class, ...{$kindMiddleware}::of({$api}, "
                . var_export(AccessKind::of($this->layout->ir, $route['operation']), true) . ')])'
                . ($this->skipsForgeryCheck($route['operation']) ? '->withoutMiddleware(' . PhpClassFile::shortNameOf(self::FORGERY_MIDDLEWARE) . '::class)' : '') . ';';
            if ($this->skipsForgeryCheck($route['operation'])) {
                $imports[self::FORGERY_MIDDLEWARE] = true;
            }
        }

        $imports = array_keys($imports);
        sort($imports);
        $text = "<?php\n\ndeclare(strict_types=1);\n\n"
            . implode('', array_map(static fn (string $import): string => "use {$import};\n", $imports))
            . "\n// The contract routes of api '{$this->layout->ir->api->id}'; require this file inside the route group that serves them.\n"
            . implode("\n", $lines) . "\n";

        return new GeneratedFile(self::ROUTES_FILE, $text);
    }

    /**
     * The `config/seampact/<api>.php` the provider publishes (`--tag=seampact-config`): each setting read from an
     * `env()` variable, `SEAMPACT_<API>_<SETTING>`, falling back to the route table's `DEFAULTS` so a regenerate with
     * other options still reaches a file published earlier, and the empty middleware lists.
     */
    public function configFile(): GeneratedFile
    {
        $api = $this->layout->ir->api->id;
        $prefix = 'SEAMPACT_' . strtoupper((string) preg_replace(['/(?<=[a-z0-9])(?=[A-Z])/', '/[^A-Za-z0-9]+/'], '_', $api)) . '_';
        $indent = str_repeat(' ', $this->options->indentSpaces);
        $lines = [];
        $defaults = '\\' . $this->layout->routeTable . '::DEFAULTS';
        foreach ([...array_keys($this->defaults()), self::PUBLIC_ORIGIN] as $name) {
            $variable = var_export($prefix . strtoupper($name), true);
            $fallback = $name === self::PUBLIC_ORIGIN ? '' : ", {$defaults}[" . var_export($name, true) . ']';
            $lines[] = "{$indent}" . var_export($name, true) . " => env({$variable}{$fallback}),";
        }
        $lines[] = "{$indent}'middleware' => [";
        foreach (AccessKind::ALL as $kind) {
            $lines[] = "{$indent}{$indent}" . var_export($kind, true) . ' => [],';
        }
        $lines[] = "{$indent}],";

        return new GeneratedFile(self::CONFIG_FILE, "<?php\n\ndeclare(strict_types=1);\n\n"
            . "// The run-time settings of api '{$api}', read as config('seampact.{$api}.*'); an operation's own settings go under 'operations'.\n"
            . "return [\n" . implode("\n", $lines) . "\n];\n");
    }

    /** @return array{responses: string, body_validation: bool, framework_etag: string, catch_all: bool} */
    private function defaults(): array
    {
        return [
            'responses' => $this->options->responses->value,
            'body_validation' => $this->options->bodyValidation,
            'framework_etag' => $this->options->frameworkEtag->value,
            'catch_all' => $this->options->catchAll,
        ];
    }

    private function skipsForgeryCheck(Operation $operation): bool
    {
        return AccessKind::isSigned($this->layout->ir, $operation) || !AccessKind::readsCookie($this->layout->ir, $operation);
    }

    private function routeName(Operation $operation): string
    {
        return "seampact.{$this->layout->ir->api->id}.{$operation->id}";
    }

    /** @return list<array{operation: Operation, uri: string, placeholders: list<string>, depthKey: list<int>, names: OperationNames}> */
    private function ordered(): array
    {
        $routes = $this->routes;
        usort($routes, static fn (array $first, array $second): int => $first['depthKey'] <=> $second['depthKey']);

        return $routes;
    }

    /** @param list<string> $placeholders */
    private static function segmentRequirements(array $placeholders): string
    {
        if ($placeholders === []) {
            return '';
        }

        return '->where(' . (new Dumper())->dump(array_fill_keys($placeholders, RoutePlaceholder::SEGMENT_REQUIREMENT)) . ')';
    }

    private function refusePath(string $form, string $description, IrPlace $at): void
    {
        $this->refusals->add("{$form}.unsupported", "{$description}.", "Give the segment its own path parameter, or rename it without '{', '}' or '?'.", $at->below('path'));
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;

/**
 * The api's boot check (ADR 0023 "The boot check"): every problem listed at once, with the operation, the name and
 * the fix, then thrown, so the app does not serve. It reads the container's bindings and tags, the router's routes
 * and the kernel's middleware, after every provider booted.
 */
final class BootCheck
{
    public const HOOKS = 'hooks';
    public const HANDLERS = 'handlers';
    public const FRAMEWORK_ROUTES = 'frameworkRoutes';
    private const LARAVEL_MAJOR = '13.';
    private const HEALTH_ACTION = 'Illuminate\\Foundation\\Http\\HealthCheck';
    private const OWN_ROUTE_NAMES = '/^(storage\.[^.]+(\.upload)?|sanctum\.csrf-cookie)$/D';
    private const SUBSTITUTE_BINDINGS = 'Illuminate\\Routing\\Middleware\\SubstituteBindings';
    private const HEAD = 'HEAD';
    private const GENERATED_ROUTE_NAME = '/^seampact\.([^.]+)\./D';

    private function __construct()
    {
    }

    /**
     * @param array{hooks: bool, handlers: bool, frameworkRoutes: bool} $switches
     * @throws BootCheckFailedException
     */
    public static function run(Application $app, ApiContract $contract, string $boundaryClass, string $accessClass, array $switches): void
    {
        $problems = [
            ...($switches[self::HOOKS] ? self::hooks($app, $contract) : []),
            ...self::middleware($app, $boundaryClass, $accessClass),
            ...self::routes($app, $contract, $accessClass, $switches),
            ...self::platform(),
        ];

        if ($problems !== []) {
            throw new BootCheckFailedException("seampact: the api '{$contract->api}' cannot start:\n- " . implode("\n- ", $problems));
        }
    }

    /** @return list<string> */
    private static function hooks(Application $app, ApiContract $contract): array
    {
        $problems = [];
        $identities = [];
        $scopes = [];
        $deciderNames = [];
        foreach ($contract->operationIds() as $operationId) {
            $operation = $contract->operation($operationId);
            $identity = Ir::string(Ir::map($operation, 'access'), 'identity');
            if ($identity !== null) {
                $identities[$identity] = true;
            }
            foreach (Ir::maps($operation, 'scopes') as $scope) {
                $scopes[Ir::string($scope, 'scope') ?? ''] = true;
            }
            foreach (Ir::maps($operation, 'requires') as $requirement) {
                $deciderNames[Ir::string($requirement, 'right') ?? Ir::string($requirement, 'rule') ?? ''] = true;
            }
            foreach (Ir::maps($operation, 'fieldRights') as $fieldRight) {
                $deciderNames[Ir::string($fieldRight, 'right') ?? ''] = true;
            }
        }

        foreach (array_keys($identities) as $identity) {
            try {
                (new Hooks($app))->authenticateHook($contract, (string) $identity);
            } catch (\LogicException) {
                $interface = Ir::string(Ir::map(Ir::map($contract->types, 'identities'), (string) $identity), 'hook') ?? '';
                $problems[] = "no authenticate hook for the identity '{$identity}': bind {$interface} in the container";
            }
        }
        foreach (array_keys($scopes) as $scope) {
            if (HookSelection::scopeResolver(new Hooks($app), $contract, (string) $scope) === null) {
                $problems[] = "no scope resolver for the scope '{$scope}': tag a ScopeResolver with '" . Hooks::scopeResolversTag($contract->api) . "'";
            }
        }
        foreach (array_keys($deciderNames) as $name) {
            if (HookSelection::decider(new Hooks($app), $contract, (string) $name) === null) {
                $problems[] = "no decider for '{$name}': tag a Decider naming it, or '" . Decider::EVERY_NAME . "', with '" . Hooks::decidersTag($contract->api) . "'";
            }
        }

        return [...$problems, ...self::claimedTwice($app, $contract)];
    }

    /** @return list<string> */
    private static function claimedTwice(Application $app, ApiContract $contract): array
    {
        $claimed = [];
        $problems = [];
        foreach ($app->tagged(Hooks::decidersTag($contract->api)) as $decider) {
            if (!$decider instanceof Decider) {
                $problems[] = 'a service tagged ' . Hooks::decidersTag($contract->api) . ' (' . get_debug_type($decider) . ') does not implement ' . Decider::class;
                continue;
            }
            foreach ($decider->names() as $name) {
                if (isset($claimed[$name]) && $claimed[$name] !== $decider::class) {
                    $problems[] = "two deciders claim '{$name}': {$claimed[$name]} and " . $decider::class . '; keep one';
                }
                $claimed[$name] = $decider::class;
            }
        }

        return $problems;
    }

    /** @return list<string> */
    private static function middleware(Application $app, string $boundaryClass, string $accessClass): array
    {
        $kernel = $app->make(Kernel::class);
        $problems = [];
        $global = method_exists($kernel, 'getGlobalMiddleware') ? $kernel->getGlobalMiddleware() : [];
        if (!is_array($global) || ($global[0] ?? null) !== $boundaryClass) {
            $problems[] = "the boundary middleware {$boundaryClass} is not the first global middleware: prepend no global middleware before it";
        }

        $priority = method_exists($kernel, 'getMiddlewarePriority') ? $kernel->getMiddlewarePriority() : [];
        $priority = is_array($priority) ? $priority : [];
        $access = array_search($accessClass, $priority, true);
        $bindings = array_search(self::SUBSTITUTE_BINDINGS, $priority, true);
        if ($access === false || ($bindings !== false && $access > $bindings)) {
            $problems[] = "the access middleware {$accessClass} is not before SubstituteBindings in the middleware priority";
        }

        return $problems;
    }

    /**
     * @param array{hooks: bool, handlers: bool, frameworkRoutes: bool} $switches
     * @return list<string>
     */
    private static function routes(Application $app, ApiContract $contract, string $accessClass, array $switches): array
    {
        $router = $app->make(Router::class);
        $problems = [];
        $contractRoutes = [];
        $contractActions = [];
        foreach ($contract->routeTable as $entry) {
            $action = $entry['action'] ?? null;
            if (is_array($action) && is_string($action[0] ?? null)) {
                $contractActions[$action[0]] = true;
                if ($switches[self::HANDLERS] && !$app->bound($action[0])) {
                    $problems[] = "operation '" . (is_string($entry['operation'] ?? null) ? $entry['operation'] : '') . "' has no handler: bind {$action[0]} to a controller in the container";
                }
                $binding = $app instanceof \Illuminate\Container\Container ? ($app->getBindings()[$action[0]] ?? null) : null;
                $concrete = is_array($binding) ? ($binding['concrete'] ?? null) : null;
                if (is_string($concrete)) {
                    $contractActions[$concrete] = true;
                }
            }
        }

        $ownNames = [];
        foreach ($contract->routeTable as $entry) {
            if (is_string($entry['operation'] ?? null)) {
                $ownNames[$contract->routeName($entry['operation'])] = true;
            }
        }

        foreach ($router->getRoutes()->getRoutes() as $route) {
            $name = $route->getName() ?? '';
            if (isset($ownNames[$name])) {
                $contractRoutes[$name][] = $route;
                continue;
            }
            $controller = explode('@', $route->getActionName())[0];
            if (isset($contractActions[$controller])) {
                $problems[] = "the route " . self::methods($route) . " /" . ltrim($route->uri(), '/') . " calls a contract handler ({$route->getActionName()}) but no generated registration made it: remove it";
            } elseif ($switches[self::FRAMEWORK_ROUTES] && !self::isLaravelsOwn($route) && !self::isOtherApisRoute($app, $name) && !self::isAllowListed($contract, $route)) {
                $problems[] = "the framework route " . self::methods($route) . " /" . ltrim($route->uri(), '/') . " is outside the contract: allow-list it in the entry's frameworkRoutes, or remove it";
            }
        }

        foreach ($contract->routeTable as $entry) {
            $operation = is_string($entry['operation'] ?? null) ? $entry['operation'] : '';
            $routes = $contractRoutes[$contract->routeName($operation)] ?? [];
            if (count($routes) !== 1) {
                $problems[] = "operation '{$operation}' has " . count($routes) . " contract routes: call Route::seampact('{$contract->api}') once in the app's routes";
                continue;
            }
            $route = $routes[0];
            $uri = is_string($entry['uri'] ?? null) ? $entry['uri'] : '';
            if ('/' . ltrim($route->uri(), '/') !== $uri) {
                $problems[] = "operation '{$operation}' is served at /" . ltrim($route->uri(), '/') . " instead of {$uri}: call the macro outside any route group prefix";
            }
            if (!in_array($accessClass, $route->gatherMiddleware(), true)) {
                $problems[] = "operation '{$operation}' runs without the access middleware: remove the withoutMiddleware() call on its route";
            }
        }

        return $problems;
    }

    private static function methods(Route $route): string
    {
        return implode('|', array_filter($route->methods(), is_string(...)));
    }

    // An entry of `frameworkRoutes` takes the route when its path pattern matches the route's URI (`*` one segment,
    // `**` any number) and it names no method, or the route's one method besides the HEAD Laravel adds to GET.
    private static function isAllowListed(ApiContract $contract, Route $route): bool
    {
        return self::allowsRoute($contract->frameworkRoutes, '/' . ltrim($route->uri(), '/'), array_values(array_filter($route->methods(), is_string(...))));
    }

    /**
     * Whether an entry of `$frameworkRoutes` takes the route at `$uri` answering `$methods`.
     *
     * @param list<array{path: string, method: ?string}> $frameworkRoutes
     * @param list<string> $methods
     */
    public static function allowsRoute(array $frameworkRoutes, string $uri, array $methods): bool
    {
        $methods = array_values(array_diff($methods, [self::HEAD]));
        foreach ($frameworkRoutes as $allowed) {
            $methodAllowed = $allowed['method'] === null || $methods === [$allowed['method']];
            if ($methodAllowed && preg_match(self::pathPattern($allowed['path']), $uri) === 1) {
                return true;
            }
        }

        return false;
    }

    // A generated route of another api of the app: its name is in the route table that api's provider registered.
    private static function isOtherApisRoute(Application $app, string $name): bool
    {
        $tableKey = preg_match(self::GENERATED_ROUTE_NAME, $name, $parts) === 1 ? ContractServiceProvider::routeTableKey($parts[1]) : null;
        if ($tableKey === null || !$app->bound($tableKey)) {
            return false;
        }
        $routesClass = $app->make($tableKey);
        $table = is_string($routesClass) && defined("{$routesClass}::ROUTES") ? constant("{$routesClass}::ROUTES") : [];

        return is_array($table) && in_array($name, array_column($table, 'name'), true);
    }

    private static function pathPattern(string $path): string
    {
        $segments = array_map(
            static fn (string $segment): string => match ($segment) {
                '**' => '(?:/[^/]+)*',
                '*' => '/[^/]+',
                default => '/' . preg_quote($segment, '#'),
            },
            array_slice(explode('/', $path), 1),
        );

        return '#^' . ($segments === [] ? '/' : implode('', $segments)) . '$#D';
    }

    private static function isLaravelsOwn(Route $route): bool
    {
        return explode('@', $route->getActionName())[0] === self::HEALTH_ACTION
            || preg_match(self::OWN_ROUTE_NAMES, $route->getName() ?? '') === 1;
    }

    /** @return list<string> */
    private static function platform(): array
    {
        $problems = [];
        if (!extension_loaded('zlib')) {
            $problems[] = 'ext-zlib is not loaded: the boundary decodes gzip and deflate bodies with it';
        }
        if (!str_starts_with(\Illuminate\Foundation\Application::VERSION, self::LARAVEL_MAJOR)) {
            $problems[] = 'Laravel ' . \Illuminate\Foundation\Application::VERSION . ' runs here, and the generated code serves Laravel 13 only';
        }

        return $problems;
    }
}

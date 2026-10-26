<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

use Symfony\Component\Config\Loader\LoaderInterface;
use Symfony\Component\Config\Loader\LoaderResolverInterface;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/**
 * The route part of the api's boot check (ADR 0024 "The boot check"), a decorator of `routing.loader`, which the
 * router calls with its root resource each time it builds the route collection: every problem listed at once, then
 * thrown, so no router cache is written and every request answers 500 until the routes pass. It checks each
 * operation's one contract route as the loader wrote it, an app route the router would match before one, an app route
 * to a contract handler, and, under the `frameworkRoutes` switch, each other route against the entry's allow-list.
 */
final class RouteCheck implements LoaderInterface
{
    private const OPERATION_DEFAULT = '_seampact_operation';
    private const CONTROLLER_DEFAULT = '_controller';
    private const ERROR_PREVIEW = ['_preview_error', 'error_controller::preview'];
    private const LOGOUT_NAME = '/^_logout_/';
    private const PROFILER_NAME = '/^_(wdt|profiler)/';
    private const PROFILER_CONTROLLER = 'web_profiler.controller.';

    /**
     * @param string $routingResource the resource the api's route loader answers, which the app imports
     * @param bool $checksFrameworkRoutes the `frameworkRoutes` switch of `artefacts.bootCheck`
     */
    public function __construct(
        private readonly LoaderInterface $inner,
        private readonly string $contractClass,
        private readonly string $routingResource,
        private readonly bool $checksFrameworkRoutes,
    ) {
    }

    public function load(mixed $resource, ?string $type = null): mixed
    {
        $loaded = $this->inner->load($resource, $type);
        if ($loaded instanceof RouteCollection) {
            $contract = ApiContract::of($this->contractClass);
            $problems = $this->problems($contract, $loaded);
            if ($problems !== []) {
                throw new \LogicException("seampact: the api '{$contract->api}' cannot start:\n- " . implode("\n- ", $problems));
            }
        }

        return $loaded;
    }

    public function supports(mixed $resource, ?string $type = null): bool
    {
        return $this->inner->supports($resource, $type);
    }

    public function getResolver(): LoaderResolverInterface
    {
        return $this->inner->getResolver();
    }

    public function setResolver(LoaderResolverInterface $resolver): void
    {
        $this->inner->setResolver($resolver);
    }

    /** @return list<string> */
    private function problems(ApiContract $contract, RouteCollection $routes): array
    {
        $declared = [];
        $handlers = [];
        foreach ($contract->routeTable as $entry) {
            $operation = is_string($entry['operation'] ?? null) ? $entry['operation'] : '';
            $declared[$operation] = $entry;
            $controller = $entry['controller'] ?? null;
            if (is_array($controller) && is_string($controller[0] ?? null)) {
                $handlers[$controller[0]] = true;
            }
        }

        $problems = [];
        $found = [];
        $seen = [];
        foreach ($routes->all() as $name => $route) {
            $operation = $route->getDefault(self::OPERATION_DEFAULT);
            if (is_string($operation) && $name !== $contract->routeName($operation)) {
                // A contract route of another api of the app, which that api's own check reads.
                continue;
            }

            $entry = is_string($operation) ? ($declared[$operation] ?? null) : null;
            if ($entry === null) {
                $problems = [...$problems, ...$this->appRoute($contract, $name, $route, array_keys($handlers))];
                $seen[] = $route;
                continue;
            }

            $found[(string) $operation] = ($found[(string) $operation] ?? 0) + 1;
            $problems = [...$problems, ...self::contractRoute($name, $route, $entry, $seen)];
        }

        foreach (array_keys($declared) as $operation) {
            $count = $found[$operation] ?? 0;
            if ($count !== 1) {
                $problems[] = $count === 0
                    ? "operation '{$operation}' has no route: import the resource '{$this->routingResource}' of type 'seampact' in the app's routing configuration"
                    : "operation '{$operation}' has {$count} routes: import the resource '{$this->routingResource}' of type 'seampact' once";
            }
        }

        return $problems;
    }

    /**
     * @param array<array-key, mixed> $entry
     * @param list<Route> $before the app routes registered before this one
     * @return list<string>
     */
    private static function contractRoute(string $name, Route $route, array $entry, array $before): array
    {
        $problems = [];
        $operation = is_string($entry['operation'] ?? null) ? $entry['operation'] : '';
        $path = is_string($entry['path'] ?? null) ? $entry['path'] : '';
        $method = is_string($entry['method'] ?? null) ? $entry['method'] : '';
        if ($name !== ($entry['name'] ?? null)) {
            $problems[] = "the route of operation '{$operation}' is named '{$name}', not '" . (is_string($entry['name'] ?? null) ? $entry['name'] : '') . "': import it without a name prefix";
        }
        if ($route->getPath() !== $path) {
            $problems[] = "the route of operation '{$operation}' has the path '{$route->getPath()}', not the contract's '{$path}': import it without a prefix";
        }
        if ($route->getHost() !== '' || $route->getSchemes() !== [] || $route->getCondition() !== '') {
            $problems[] = "the route of operation '{$operation}' carries a host, a scheme or a condition: import it without them";
        }

        foreach ($before as $appRoute) {
            $methods = $appRoute->getMethods();
            if ($appRoute->getPath() === $route->getPath() && ($methods === [] || in_array($method, $methods, true))) {
                $problems[] = "an app route with the path '{$route->getPath()}' is registered before the route of operation '{$operation}', so the router matches it first: import the contract routes first";
            }
        }

        return $problems;
    }

    /**
     * @param list<string> $handlers the endpoints interfaces
     * @return list<string>
     */
    private function appRoute(ApiContract $contract, string $name, Route $route, array $handlers): array
    {
        $controller = $route->getDefault(self::CONTROLLER_DEFAULT);
        $class = is_string($controller) ? explode('::', $controller, 2)[0] : (is_array($controller) && is_string($controller[0] ?? null) ? $controller[0] : null);
        foreach ($handlers as $interface) {
            if ($class !== null && ($class === $interface || is_subclass_of($class, $interface))) {
                return ["the app route '{$name}' leads to a handler of api '{$contract->api}' ({$class}): serve the operation only through its contract route"];
            }
        }

        if (!$this->checksFrameworkRoutes || self::isSymfonyRoute($name, $controller) || FrameworkRoutes::allows($contract->frameworkRoutes, $route->getPath(), array_values($route->getMethods()))) {
            return [];
        }

        return ["the app route '{$name}' ({$route->getPath()}) is not a contract route and the entry's frameworkRoutes does not list it: add it to frameworkRoutes, or turn the frameworkRoutes boot check off"];
    }

    private static function isSymfonyRoute(string $name, mixed $controller): bool
    {
        if ([$name, $controller] === self::ERROR_PREVIEW) {
            return true;
        }

        if (preg_match(self::LOGOUT_NAME, $name) === 1 && $controller === null) {
            return true;
        }

        return preg_match(self::PROFILER_NAME, $name) === 1 && is_string($controller) && str_starts_with($controller, self::PROFILER_CONTROLLER);
    }
}

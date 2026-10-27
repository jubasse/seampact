<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;

/**
 * The base of an api's generated service provider: it merges the api's generated settings file, whose `env()`
 * variables apply before it is published, and its run-time defaults into `config('seampact.<api>')`, prepends the boundary middleware, places the access middleware before
 * `SubstituteBindings`, defines the `Route::seampact()` macro, keeps `TrimStrings` and `ConvertEmptyStringsToNull`
 * off contract routes, refuses Octane workers, hides sensitive values from `dump()`, publishes the api's settings as
 * `config/seampact/<api>.php` (`--tag=seampact-config`) and runs the boot check once every provider booted.
 */
abstract class ContractServiceProvider extends ServiceProvider
{
    private const MACRO = 'seampact';
    private const SUBSTITUTE_BINDINGS = 'Illuminate\\Routing\\Middleware\\SubstituteBindings';
    private const OCTANE_WORKER_STARTING = 'Laravel\\Octane\\Events\\WorkerStarting';
    private const CACHING_COMMANDS = ['route:cache', 'optimize'];
    private const CONFIG_TAG = 'seampact-config';
    // The same key in every api's copied runtime, so each api's provider sees the others' boundaries.
    private const BOUNDARIES_KEY = 'seampact.boundaries';

    abstract protected function contractClass(): string;

    abstract protected function boundaryClass(): string;

    abstract protected function accessClass(): string;

    /** @return array{hooks: bool, handlers: bool, frameworkRoutes: bool}|null the boot check's switches, null when it is off */
    abstract protected function bootCheck(): ?array;

    /** The path of the api's generated settings file, which `vendor:publish` copies into the app's config. */
    abstract protected function publishedConfig(): string;

    public function register(): void
    {
        $contract = ApiContract::of($this->contractClass());
        $this->app->instance(self::routeTableKey($contract->api), $contract->routesClass);
        $this->app->instance(self::BOUNDARIES_KEY, [...self::boundaries($this->app), $this->boundaryClass() => ['api' => $contract->api, 'basePaths' => $contract->basePaths()]]);

        if (!method_exists($this->app, 'configurationIsCached') || !$this->app->configurationIsCached()) {
            // The app's own config first, then the generated file's `env()` settings, so `.env` works unpublished.
            $config = Services::config($this->app);
            $current = $config->get("seampact.{$contract->api}");
            $generated = require $this->publishedConfig();
            if (!is_array($generated)) {
                throw new \LogicException("seampact: {$this->publishedConfig()} does not return the settings array; regenerate the api '{$contract->api}'.");
            }
            $config->set("seampact.{$contract->api}", array_replace($contract->defaults, $generated, is_array($current) ? $current : []));
        }
    }

    public function boot(): void
    {
        $contract = ApiContract::of($this->contractClass());
        RedactingDumper::install($this->app, $contract);
        $kernel = $this->app->make(Kernel::class);
        if (method_exists($kernel, 'prependMiddleware') && method_exists($kernel, 'addToMiddlewarePriorityBefore')) {
            $kernel->prependMiddleware($this->boundaryClass());
            $kernel->addToMiddlewarePriorityBefore(self::SUBSTITUTE_BINDINGS, $this->accessClass());
        }

        if (!Route::hasMacro(self::MACRO)) {
            // The macro runs bound to the router, where `self` names the router: the key function is captured here.
            $routeTableKey = self::routeTableKey(...);
            Route::macro(self::MACRO, static function (string $api) use ($routeTableKey): void {
                $routesClass = app($routeTableKey($api));
                if (!is_string($routesClass) || !method_exists($routesClass, 'register')) {
                    throw new \LogicException("seampact: no generated routes for the api '{$api}'; list its service provider in bootstrap/providers.php.");
                }
                $routesClass::register();
            });
        }

        $api = $contract->api;
        if ($this->app->runningInConsole()) {
            $this->publishes([$this->publishedConfig() => $this->app->configPath("seampact/{$api}.php")], self::CONFIG_TAG);
        }

        $onContractRoute = static fn (Request $request): bool => BoundaryState::of($request, $api) !== null;
        TrimStrings::skipWhen($onContractRoute);
        ConvertEmptyStringsToNull::skipWhen($onContractRoute);

        ContractExceptionHandling::register($this->app->make(ExceptionHandler::class), $api);

        Services::events($this->app)->listen(self::OCTANE_WORKER_STARTING, static function () use ($api): void {
            throw new \RuntimeException("runtime.octane.unsupported: the api '{$api}' cannot run in an Octane worker. Serve the app with php-fpm, or keep this api's provider out of the Octane app.");
        });

        $switches = $this->bootCheck();
        if ($switches !== null && $this->bootCheckRuns()) {
            $this->app->booted(function () use ($contract, $switches): void {
                BootCheck::run($this->app, $contract, $this->boundaryClass(), $this->accessClass(), $switches);
            });
        }
    }

    // An HTTP boot without a route cache, and `route:cache` and `optimize`, which boot a fresh application.
    private function bootCheckRuns(): bool
    {
        if (method_exists($this->app, 'routesAreCached') && $this->app->routesAreCached()) {
            return false;
        }

        return !$this->app->runningInConsole()
            || (method_exists($this->app, 'runningConsoleCommand') && $this->app->runningConsoleCommand(self::CACHING_COMMANDS));
    }

    /**
     * Whether `$boundaryClass` leads the global middleware stack: only the boundaries of the app's other apis may come
     * before it, and none whose base path equals or prefixes one of this api's with its catch-all on, since that
     * boundary answers its 404 on this api's paths.
     *
     * @param array<mixed> $global the kernel's global middleware, in order
     */
    public static function leadsGlobalStack(Application $app, array $global, string $boundaryClass): bool
    {
        $boundaries = self::boundaries($app);
        $basePaths = $boundaries[$boundaryClass]['basePaths'] ?? [];
        foreach ($global as $middleware) {
            if ($middleware === $boundaryClass) {
                return true;
            }
            $earlier = is_string($middleware) ? ($boundaries[$middleware] ?? null) : null;
            if ($earlier === null || self::claimsPathsOf($app, $earlier, $basePaths)) {
                return false;
            }
        }

        return false;
    }

    /**
     * Whether an earlier api's boundary answers its catch-all 404 under one of `$basePaths`.
     *
     * @param array{api: string, basePaths: list<string>} $earlier
     * @param list<string> $basePaths
     */
    private static function claimsPathsOf(Application $app, array $earlier, array $basePaths): bool
    {
        if (Services::config($app)->get("seampact.{$earlier['api']}.catch_all") === false) {
            return false;
        }

        return ApiContract::basePathsCover($earlier['basePaths'], $basePaths);
    }

    /** @return array<string, array{api: string, basePaths: list<string>}> the api and base paths of each registered boundary */
    private static function boundaries(Application $app): array
    {
        $registered = $app->bound(self::BOUNDARIES_KEY) ? $app->make(self::BOUNDARIES_KEY) : [];
        $boundaries = [];
        foreach (is_array($registered) ? $registered : [] as $boundaryClass => $boundary) {
            if (is_string($boundaryClass) && is_array($boundary) && is_string($boundary['api'] ?? null) && is_array($boundary['basePaths'] ?? null)) {
                $boundaries[$boundaryClass] = ['api' => $boundary['api'], 'basePaths' => array_values(array_filter($boundary['basePaths'], is_string(...)))];
            }
        }

        return $boundaries;
    }

    /** The container key of the api's generated route table class. */
    public static function routeTableKey(string $api): string
    {
        return "seampact.{$api}.routes";
    }
}

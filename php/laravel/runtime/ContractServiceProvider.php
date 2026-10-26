<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * The base of an api's generated service provider: it merges the api's run-time defaults into
 * `config('seampact.<api>')`, prepends the boundary middleware, places the access middleware before
 * `SubstituteBindings`, defines the `Route::seampact()` macro, keeps `TrimStrings` and `ConvertEmptyStringsToNull`
 * off contract routes, refuses Octane workers and runs the boot check once every provider booted.
 */
abstract class ContractServiceProvider extends ServiceProvider
{
    private const MACRO = 'seampact';
    private const SUBSTITUTE_BINDINGS = 'Illuminate\\Routing\\Middleware\\SubstituteBindings';
    private const OCTANE_WORKER_STARTING = 'Laravel\\Octane\\Events\\WorkerStarting';
    private const CACHING_COMMANDS = ['route:cache', 'optimize'];

    abstract protected function contractClass(): string;

    abstract protected function boundaryClass(): string;

    abstract protected function accessClass(): string;

    /** @return array{hooks: bool, handlers: bool, frameworkRoutes: bool}|null the boot check's switches, null when it is off */
    abstract protected function bootCheck(): ?array;

    public function register(): void
    {
        $contract = ApiContract::of($this->contractClass());
        $this->app->instance(self::routeTableKey($contract->api), $contract->routesClass);

        if (!method_exists($this->app, 'configurationIsCached') || !$this->app->configurationIsCached()) {
            $config = Services::config($this->app);
            $current = $config->get("seampact.{$contract->api}");
            $config->set("seampact.{$contract->api}", array_replace($contract->defaults, is_array($current) ? $current : []));
        }
    }

    public function boot(): void
    {
        $contract = ApiContract::of($this->contractClass());
        $kernel = $this->app->make(Kernel::class);
        if (method_exists($kernel, 'prependMiddleware') && method_exists($kernel, 'addToMiddlewarePriorityBefore')) {
            $kernel->prependMiddleware($this->boundaryClass());
            $kernel->addToMiddlewarePriorityBefore(self::SUBSTITUTE_BINDINGS, $this->accessClass());
        }

        if (!Route::hasMacro(self::MACRO)) {
            Route::macro(self::MACRO, static function (string $api): void {
                $routesClass = app(self::routeTableKey($api));
                if (!is_string($routesClass) || !method_exists($routesClass, 'register')) {
                    throw new \LogicException("seampact: no generated routes for the api '{$api}'; list its service provider in bootstrap/providers.php.");
                }
                $routesClass::register();
            });
        }

        $api = $contract->api;
        $onContractRoute = static fn (Request $request): bool => BoundaryState::of($request, $api) !== null;
        TrimStrings::skipWhen($onContractRoute);
        ConvertEmptyStringsToNull::skipWhen($onContractRoute);

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

    private static function routeTableKey(string $api): string
    {
        return "seampact.{$api}.routes";
    }
}

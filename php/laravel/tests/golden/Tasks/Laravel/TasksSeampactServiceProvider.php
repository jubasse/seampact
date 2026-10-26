<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

use Seampact\Golden\Tasks\Laravel\Runtime\ContractServiceProvider;
use Seampact\Golden\Tasks\Laravel\Runtime\Hooks;

/**
 * Serves api 'tasks': list it in bootstrap/providers.php, then call Route::seampact('tasks') in the app's routes.
 */
final class TasksSeampactServiceProvider extends ContractServiceProvider
{
    /** The container tag of the deciders of this api. */
    public const DECIDERS_TAG = Hooks::TAG_PREFIX . 'tasks' . Hooks::DECIDERS_TAG_SUFFIX;

    /** The container tag of the scope resolvers of this api. */
    public const SCOPE_RESOLVERS_TAG = Hooks::TAG_PREFIX . 'tasks' . Hooks::SCOPE_RESOLVERS_TAG_SUFFIX;

    protected function contractClass(): string
    {
        return TasksContract::class;
    }

    protected function boundaryClass(): string
    {
        return TasksBoundary::class;
    }

    protected function accessClass(): string
    {
        return TasksAccessMiddleware::class;
    }

    /**
     * The api's run-time settings with their `env()` variables, published as config/seampact/<api>.php.
     */
    protected function publishedConfig(): string
    {
        return dirname(__DIR__) . '/config.php';
    }

    /**
     * @return array{hooks: bool, handlers: bool, frameworkRoutes: bool}
     */
    protected function bootCheck(): array
    {
        return ['hooks' => true, 'handlers' => true, 'frameworkRoutes' => true];
    }
}

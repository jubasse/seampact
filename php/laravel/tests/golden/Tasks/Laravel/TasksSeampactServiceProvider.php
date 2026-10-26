<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

use Seampact\Golden\Tasks\Laravel\Runtime\ContractServiceProvider;

/**
 * Serves api 'tasks': list it in bootstrap/providers.php, then call Route::seampact('tasks') in the app's routes.
 */
final class TasksSeampactServiceProvider extends ContractServiceProvider
{
    /** The container tag of the deciders of this api. */
    public const DECIDERS_TAG = 'seampact.tasks.deciders';

    /** The container tag of the scope resolvers of this api. */
    public const SCOPE_RESOLVERS_TAG = 'seampact.tasks.scope-resolvers';

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
     * @return array{hooks: bool, handlers: bool, frameworkRoutes: bool}
     */
    protected function bootCheck(): array
    {
        return ['hooks' => true, 'handlers' => true, 'frameworkRoutes' => true];
    }
}

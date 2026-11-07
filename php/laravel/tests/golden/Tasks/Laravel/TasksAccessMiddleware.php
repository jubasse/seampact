<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

use Seampact\Laravel\Runtime\AccessMiddleware;

/**
 * The AccessMiddleware of api 'tasks': steps 2 to 5 of each contract route.
 */
final class TasksAccessMiddleware extends AccessMiddleware
{
    protected function contractClass(): string
    {
        return TasksContract::class;
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel;

use Seampact\Laravel\Runtime\BoundaryMiddleware;

/**
 * The BoundaryMiddleware of api 'tasks': steps 1 and 10 of every request under its base paths.
 */
final class TasksBoundary extends BoundaryMiddleware
{
    protected function contractClass(): string
    {
        return TasksContract::class;
    }
}

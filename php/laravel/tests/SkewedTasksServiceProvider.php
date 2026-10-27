<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Seampact\Golden\TasksConsistent\Laravel\TasksAccessMiddleware;
use Seampact\Golden\TasksConsistent\Laravel\TasksBoundary;
use Seampact\Laravel\Runtime\ContractServiceProvider;

/** The service provider of the golden tasks api, as another seampact version generated it. */
final class SkewedTasksServiceProvider extends ContractServiceProvider
{
    protected function contractClass(): string
    {
        return SkewedTasksContract::class;
    }

    protected function boundaryClass(): string
    {
        return TasksBoundary::class;
    }

    protected function accessClass(): string
    {
        return TasksAccessMiddleware::class;
    }

    protected function bootCheck(): ?array
    {
        return null;
    }

    protected function publishedConfig(): string
    {
        return __DIR__ . '/golden/TasksConsistent/config.php';
    }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use Seampact\ApiPlatform\Runtime\ReplyDecorator;
use Seampact\Golden\Tasks\Symfony\TasksContract;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/**
 * Writes the contract reply of api 'tasks' for a generated result, between API Platform's write and serialize steps.
 */
#[Exclude]
final class TasksReplyDecorator extends ReplyDecorator
{
    protected function contractClass(): string
    {
        return TasksContract::class;
    }

    protected function apiId(): string
    {
        return 'tasks';
    }
}

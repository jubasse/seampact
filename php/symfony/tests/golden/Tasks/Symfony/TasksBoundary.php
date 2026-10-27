<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\Symfony\Runtime\BoundarySubscriber;
use Seampact\Golden\Tasks\TasksContractException;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\Validator\Constraint;

/**
 * The boundary of api 'tasks', which the bundle registers as an event subscriber.
 */
#[Exclude]
final class TasksBoundary extends BoundarySubscriber
{
    protected function contractClass(): string
    {
        return TasksContract::class;
    }

    protected function inputConstraint(string $operationId): Constraint
    {
        return match ($operationId) {
            'getChannel' => new GetChannelInputConstraint(),
            'getDraft' => new GetDraftInputConstraint(),
            'getTask' => new GetTaskInputConstraint(),
            'getTasksBatch' => new GetTasksBatchInputConstraint(),
            'health' => new HealthInputConstraint(),
            default => throw new \LogicException("seampact: the api 'tasks' has no operation '{$operationId}'."),
        };
    }

    protected function inputAttribute(): string
    {
        return TasksInputResolver::INPUT_ATTRIBUTE;
    }

    protected function contractExceptionClass(): string
    {
        return TasksContractException::class;
    }

    protected function checksHooks(): bool
    {
        return true;
    }
}

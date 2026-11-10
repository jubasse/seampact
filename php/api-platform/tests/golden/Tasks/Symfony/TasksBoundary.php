<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\ApiPlatform\Runtime\ApiPlatformBoundarySubscriber;
use Seampact\Golden\Tasks\TasksContractException;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\Validator\Constraint;

/**
 * The boundary of api 'tasks', which the bundle registers as an event subscriber.
 */
#[Exclude]
final class TasksBoundary extends ApiPlatformBoundarySubscriber
{
    protected function contractClass(): string
    {
        return TasksContract::class;
    }

    protected function inputConstraint(string $operationId): Constraint
    {
        return match ($operationId) {
            'archiveTask' => new ArchiveTaskInputConstraint(),
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

    protected function operationAttribute(): string
    {
        return SeampactOperation::class;
    }

    protected function contractExceptionClass(): string
    {
        return TasksContractException::class;
    }

    protected function checksHooks(): bool
    {
        return true;
    }

    protected function checksInputRules(): bool
    {
        return false;
    }
}

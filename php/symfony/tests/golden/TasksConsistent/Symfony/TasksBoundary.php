<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\Symfony\Runtime\BoundarySubscriber;
use Seampact\Golden\TasksConsistent\TasksContractException;
use Symfony\Component\Validator\Constraint;

/**
 * The boundary of api 'tasks', which the bundle registers as an event subscriber.
 */
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

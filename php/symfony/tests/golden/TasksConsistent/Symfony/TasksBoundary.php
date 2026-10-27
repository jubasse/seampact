<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\Symfony\Runtime\BoundarySubscriber;
use Seampact\Golden\TasksConsistent\TasksContractException;
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
      'createTask' => new CreateTaskInputConstraint(),
      'getChannel' => new GetChannelInputConstraint(),
      'getDraft' => new GetDraftInputConstraint(),
      'getPreferences' => new GetPreferencesInputConstraint(),
      'getTask' => new GetTaskInputConstraint(),
      'getTasksBatch' => new GetTasksBatchInputConstraint(),
      'health' => new HealthInputConstraint(),
      'listTasks' => new ListTasksInputConstraint(),
      'payments' => new PaymentsInputConstraint(),
      'purgeTask' => new PurgeTaskInputConstraint(),
      'searchTasks' => new SearchTasksInputConstraint(),
      'updateTask' => new UpdateTaskInputConstraint(),
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

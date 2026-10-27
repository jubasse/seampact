<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\CreateTaskInput;
use Seampact\Golden\TasksConsistent\GetChannelInput;
use Seampact\Golden\TasksConsistent\GetDraftInput;
use Seampact\Golden\TasksConsistent\GetPreferencesInput;
use Seampact\Golden\TasksConsistent\GetTaskInput;
use Seampact\Golden\TasksConsistent\GetTasksBatchInput;
use Seampact\Golden\TasksConsistent\HealthInput;
use Seampact\Golden\TasksConsistent\ListTasksInput;
use Seampact\Golden\TasksConsistent\PaymentsInput;
use Seampact\Golden\TasksConsistent\PurgeTaskInput;
use Seampact\Golden\TasksConsistent\SearchTasksInput;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\ContractBypassedException;
use Seampact\Golden\TasksConsistent\UpdateTaskInput;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Controller\ValueResolverInterface;
use Symfony\Component\HttpKernel\ControllerMetadata\ArgumentMetadata;

/**
 * Hands each contract handler the input the boundary checked for its operation.
 */
#[Exclude]
final class TasksInputResolver implements ValueResolverInterface
{
  public const INPUT_ATTRIBUTE = '_seampact_tasks_input';
  public const PRIORITY = 150;
  private const INPUT_CLASSES = [CreateTaskInput::class, GetChannelInput::class, GetDraftInput::class, GetPreferencesInput::class, GetTaskInput::class, GetTasksBatchInput::class, HealthInput::class, ListTasksInput::class, PaymentsInput::class, PurgeTaskInput::class, SearchTasksInput::class, UpdateTaskInput::class];

  /**
   * @return list<object>
   */
  public function resolve(Request $request, ArgumentMetadata $argument): iterable
  {
    $type = $argument->getType();
    if ($type === null || !in_array($type, self::INPUT_CLASSES, true)) {
        return [];
    }

    $input = $request->attributes->get(self::INPUT_ATTRIBUTE);
    if (!$input instanceof $type) {
        throw new ContractBypassedException("The handler parameter '{$argument->getName()}' takes the contract input {$type}, but no checked input of that operation is stored: the request did not pass the boundary, as a sub-request from forward() or a direct call does.");
    }

    return [$input];
  }
}

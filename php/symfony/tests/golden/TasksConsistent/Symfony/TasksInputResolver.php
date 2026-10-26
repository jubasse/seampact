<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\GetChannelInput;
use Seampact\Golden\TasksConsistent\GetDraftInput;
use Seampact\Golden\TasksConsistent\GetTaskInput;
use Seampact\Golden\TasksConsistent\GetTasksBatchInput;
use Seampact\Golden\TasksConsistent\HealthInput;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\ContractBypassedException;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Controller\ValueResolverInterface;
use Symfony\Component\HttpKernel\ControllerMetadata\ArgumentMetadata;

/**
 * Hands each contract handler the input the boundary checked for its operation.
 */
final class TasksInputResolver implements ValueResolverInterface
{
  public const INPUT_ATTRIBUTE = '_seampact_tasks_input';
  public const PRIORITY = 150;
  private const INPUT_CLASSES = [GetChannelInput::class, GetDraftInput::class, GetTaskInput::class, GetTasksBatchInput::class, HealthInput::class];

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

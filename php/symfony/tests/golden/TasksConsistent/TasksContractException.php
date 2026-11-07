<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * A declared error of api 'tasks', thrown by a handler.
 */
abstract class TasksContractException extends \RuntimeException
{
  abstract public function contractCode(): string;

  abstract public function status(): int;
}

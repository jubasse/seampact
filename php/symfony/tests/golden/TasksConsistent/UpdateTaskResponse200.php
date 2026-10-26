<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\Task;

/**
 * The 200 reply of operation 'updateTask'.
 */
final readonly class UpdateTaskResponse200 implements UpdateTaskResult
{
  public function __construct(
    public Task $body,
  ) {
  }
}

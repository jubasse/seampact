<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\Task;

/**
 * The 201 reply of operation 'createTask'.
 */
final readonly class CreateTaskResponse201 implements CreateTaskResult
{
  public function __construct(
    public Task $body,
  ) {
  }
}

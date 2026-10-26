<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\Task;

/**
 * The 200 reply of operation 'listTasks'.
 */
final readonly class ListTasksResponse200 implements ListTasksResult
{
  public function __construct(
    public ListTasksPage $body,
  ) {
  }
}

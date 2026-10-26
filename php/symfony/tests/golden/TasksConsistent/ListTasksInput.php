<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The input of operation 'listTasks', as its handler reads it.
 */
final readonly class ListTasksInput
{
  public function __construct(
    public ListTasksPath $path,
    public ListTasksQuery $query,
  ) {
  }
}

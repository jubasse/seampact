<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\TaskSearchResult;

/**
 * The 200 reply of operation 'searchTasks'.
 */
final readonly class SearchTasksResponse200 implements SearchTasksResult
{
  public function __construct(
    public TaskSearchResult $body,
  ) {
  }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The path parameters of operation 'searchTasks'.
 */
final readonly class SearchTasksPath
{
  public function __construct(
    public string $channelId,
  ) {
  }
}

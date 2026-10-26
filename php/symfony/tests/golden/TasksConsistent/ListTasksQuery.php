<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The query parameters of operation 'listTasks'.
 */
final readonly class ListTasksQuery
{
  /**
   * @param list<string>|null $sort
   */
  public function __construct(
    public ?string $cursor,
    public ?int $limit,
    public ?array $sort,
  ) {
  }
}

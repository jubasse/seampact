<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'TaskQuery'.
 */
final readonly class TaskQuery
{
  /**
   * @param list<TaskState>|null $states
   */
  public function __construct(
    public ?string $text,
    public ?array $states,
  ) {
  }
}

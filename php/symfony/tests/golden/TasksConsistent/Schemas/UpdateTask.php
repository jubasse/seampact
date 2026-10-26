<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'UpdateTask'.
 */
final readonly class UpdateTask
{
  public function __construct(
    public ?string $title,
    public ?TaskState $state,
    public ?int $effort,
    public int $expectedVersion,
  ) {
  }
}

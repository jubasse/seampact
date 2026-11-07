<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use DateTimeImmutable;
use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'Task'.
 */
final readonly class Task
{
  public function __construct(
    #[Assert\NotNull]
    public string $taskId,
    #[Assert\NotNull, Assert\Length(min: 1, max: 200)]
    public string $title,
    #[Assert\NotNull]
    public TaskState $state,
    #[Assert\GreaterThanOrEqual(value: 0)]
    public ?int $effort,
    #[Assert\NotNull, Assert\GreaterThanOrEqual(value: 1)]
    public int $version,
    #[Assert\NotNull]
    public DateTimeImmutable $createdAt,
  ) {
  }
}

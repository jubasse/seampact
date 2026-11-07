<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'UpdateTask'.
 */
final readonly class UpdateTask
{
  public function __construct(
    #[Assert\Length(min: 1, max: 200)]
    public ?string $title,
    public ?TaskState $state,
    #[Assert\GreaterThanOrEqual(value: 0)]
    public ?int $effort,
    #[Assert\NotNull, Assert\GreaterThanOrEqual(value: 1)]
    public int $expectedVersion,
  ) {
  }
}

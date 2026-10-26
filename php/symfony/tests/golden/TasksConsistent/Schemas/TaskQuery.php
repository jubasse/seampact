<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'TaskQuery'.
 */
final readonly class TaskQuery
{
  /**
   * @param list<TaskState>|null $states
   */
  public function __construct(
    #[Assert\Length(max: 200)]
    public ?string $text,
    #[Assert\Count(max: 3), Assert\All(constraints: [new Assert\NotNull()])]
    public ?array $states,
  ) {
  }
}

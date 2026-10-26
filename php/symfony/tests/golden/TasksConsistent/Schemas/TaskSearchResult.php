<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'TaskSearchResult'.
 */
final readonly class TaskSearchResult
{
  /**
   * @param list<Task> $items
   */
  public function __construct(
    #[Assert\NotNull, Assert\Valid, Assert\All(constraints: [new Assert\NotNull()])]
    public array $items,
    #[Assert\GreaterThanOrEqual(value: 0)]
    public ?int $total,
  ) {
  }
}

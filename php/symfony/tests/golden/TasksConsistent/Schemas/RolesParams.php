<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'RolesParams'.
 */
final readonly class RolesParams
{
  /**
   * @param list<Role> $allowed
   */
  public function __construct(
    #[Assert\NotNull, Assert\Count(min: 1), Assert\All(constraints: [new Assert\NotNull()])]
    public array $allowed,
  ) {
  }
}

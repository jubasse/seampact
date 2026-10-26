<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'Health'.
 */
final readonly class Health
{
  public function __construct(
    #[Assert\NotNull]
    public string $status,
  ) {
  }
}

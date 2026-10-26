<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'IssuesItem'.
 */
final readonly class IssuesItem
{
  public function __construct(
    #[Assert\NotNull]
    public string $pointer,
    #[Assert\NotNull]
    public string $rule,
  ) {
  }
}

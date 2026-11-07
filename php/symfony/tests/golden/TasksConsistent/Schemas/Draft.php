<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'Draft'.
 */
final readonly class Draft
{
  public function __construct(
    #[Assert\NotNull]
    public string $draftId,
    #[Assert\NotNull, Assert\Length(max: 20000)]
    public string $body,
  ) {
  }
}

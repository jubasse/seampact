<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'Preferences'.
 */
final readonly class Preferences
{
  public function __construct(
    #[Assert\NotNull, Assert\Length(min: 2, max: 35)]
    public string $locale,
    public ?bool $digest,
  ) {
  }
}

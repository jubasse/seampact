<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'Preferences'.
 */
final readonly class Preferences
{
  public function __construct(
    public string $locale,
    public ?bool $digest,
  ) {
  }
}

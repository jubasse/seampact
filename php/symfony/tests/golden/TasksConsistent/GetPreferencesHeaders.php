<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The headers parameters of operation 'getPreferences'.
 */
final readonly class GetPreferencesHeaders
{
  public function __construct(
    public ?string $ifNoneMatch,
  ) {
  }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\Preferences;

/**
 * The 200 reply of operation 'getPreferences'.
 */
final readonly class GetPreferencesResponse200 implements GetPreferencesResult
{
  public function __construct(
    public Preferences $body,
  ) {
  }
}

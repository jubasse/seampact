<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'getPreferences', as its handler reads it.
 */
final readonly class GetPreferencesInput
{
  public function __construct(
    public GetPreferencesHeaders $headers,
    public UserPrincipal $principal,
  ) {
  }
}

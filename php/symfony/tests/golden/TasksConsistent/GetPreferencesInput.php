<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'getPreferences', as its handler reads it.
 */
final readonly class GetPreferencesInput
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public GetPreferencesHeaders $headers,
    #[\SensitiveParameter]
    private UserPrincipal $principal,
  ) {
  }

  /**
   * The caller.
   */
  public function principal(): UserPrincipal
  {
    return $this->principal;
  }

  /**
   * @return array<string, mixed> each sensitive member redacted, so a dump never shows it
   */
  public function __debugInfo(): array
  {
    return [
      'headers' => $this->headers,
      'principal' => self::REDACTED,
    ];
  }
}

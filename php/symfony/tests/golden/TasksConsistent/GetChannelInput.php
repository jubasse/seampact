<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'getChannel', as its handler reads it.
 */
final readonly class GetChannelInput
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public GetChannelPath $path,
    #[\SensitiveParameter]
    private UserPrincipal $principal,
    #[\SensitiveParameter]
    private GetChannelScopes $scopes,
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
   * The scopes the operation runs in, as their resolvers resolved them.
   */
  public function scopes(): GetChannelScopes
  {
    return $this->scopes;
  }

  /**
   * @return array<string, mixed> each sensitive member redacted, so a dump never shows it
   */
  public function __debugInfo(): array
  {
    return [
      'path' => $this->path,
      'principal' => self::REDACTED,
      'scopes' => self::REDACTED,
    ];
  }
}

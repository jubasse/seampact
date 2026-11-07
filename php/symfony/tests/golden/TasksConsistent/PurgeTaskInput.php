<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\ApiEmptyBody;
use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'purgeTask', as its handler reads it.
 */
final readonly class PurgeTaskInput
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public PurgeTaskPath $path,
    public PurgeTaskHeaders $headers,
    public ApiEmptyBody $body,
    #[\SensitiveParameter]
    private UserPrincipal $principal,
    #[\SensitiveParameter]
    private PurgeTaskScopes $scopes,
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
  public function scopes(): PurgeTaskScopes
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
      'headers' => $this->headers,
      'body' => $this->body,
      'principal' => self::REDACTED,
      'scopes' => self::REDACTED,
    ];
  }
}

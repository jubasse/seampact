<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\UpdateTask;
use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'updateTask', as its handler reads it.
 */
final readonly class UpdateTaskInput
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public UpdateTaskPath $path,
    public UpdateTaskHeaders $headers,
    public UpdateTask $body,
    #[\SensitiveParameter]
    private UserPrincipal $principal,
    #[\SensitiveParameter]
    private UpdateTaskScopes $scopes,
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
  public function scopes(): UpdateTaskScopes
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

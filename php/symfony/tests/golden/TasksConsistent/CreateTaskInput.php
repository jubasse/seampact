<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\CreateTask;
use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'createTask', as its handler reads it.
 */
final readonly class CreateTaskInput
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public CreateTaskPath $path,
    public CreateTaskHeaders $headers,
    public CreateTask $body,
    #[\SensitiveParameter]
    private UserPrincipal $principal,
    #[\SensitiveParameter]
    private CreateTaskScopes $scopes,
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
  public function scopes(): CreateTaskScopes
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

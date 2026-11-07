<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'listTasks', as its handler reads it.
 */
final readonly class ListTasksInput
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public ListTasksPath $path,
    public ListTasksQuery $query,
    #[\SensitiveParameter]
    private UserPrincipal $principal,
    #[\SensitiveParameter]
    private ListTasksScopes $scopes,
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
  public function scopes(): ListTasksScopes
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
      'query' => $this->query,
      'principal' => self::REDACTED,
      'scopes' => self::REDACTED,
    ];
  }
}

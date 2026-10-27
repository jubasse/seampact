<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\TaskQuery;
use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'searchTasks', as its handler reads it.
 */
final readonly class SearchTasksInput
{
  private const REDACTED = '[redacted]';

  public function __construct(
    public SearchTasksPath $path,
    public TaskQuery $body,
    #[\SensitiveParameter]
    private UserPrincipal $principal,
    #[\SensitiveParameter]
    private SearchTasksScopes $scopes,
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
  public function scopes(): SearchTasksScopes
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
      'body' => $this->body,
      'principal' => self::REDACTED,
      'scopes' => self::REDACTED,
    ];
  }
}

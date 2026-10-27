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
  public function __construct(
    public SearchTasksPath $path,
    public TaskQuery $body,
    public UserPrincipal $principal,
    public SearchTasksScopes $scopes,
  ) {
  }
}

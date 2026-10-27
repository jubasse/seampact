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
  public function __construct(
    public UpdateTaskPath $path,
    public UpdateTaskHeaders $headers,
    public UpdateTask $body,
    public UserPrincipal $principal,
    public UpdateTaskScopes $scopes,
  ) {
  }
}

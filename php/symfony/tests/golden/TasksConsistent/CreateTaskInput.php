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
  public function __construct(
    public CreateTaskPath $path,
    public CreateTaskHeaders $headers,
    public CreateTask $body,
    public UserPrincipal $principal,
    public CreateTaskScopes $scopes,
  ) {
  }
}

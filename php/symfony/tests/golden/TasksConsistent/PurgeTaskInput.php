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
  public function __construct(
    public PurgeTaskPath $path,
    public PurgeTaskHeaders $headers,
    public ApiEmptyBody $body,
    public UserPrincipal $principal,
    public PurgeTaskScopes $scopes,
  ) {
  }
}

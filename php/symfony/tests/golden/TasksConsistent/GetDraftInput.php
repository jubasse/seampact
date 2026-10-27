<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'getDraft', as its handler reads it.
 */
final readonly class GetDraftInput
{
  public function __construct(
    public GetDraftPath $path,
    public UserPrincipal $principal,
  ) {
  }
}

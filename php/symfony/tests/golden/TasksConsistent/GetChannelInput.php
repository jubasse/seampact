<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Symfony\UserPrincipal;

/**
 * The input of operation 'getChannel', as its handler reads it.
 */
final readonly class GetChannelInput
{
  public function __construct(
    public GetChannelPath $path,
    public UserPrincipal $principal,
    public GetChannelScopes $scopes,
  ) {
  }
}

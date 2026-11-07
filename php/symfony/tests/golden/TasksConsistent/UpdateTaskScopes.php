<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Hooks\ResolvedScope;

/**
 * The scopes operation 'updateTask' runs in, outermost first, each as its scope resolver resolved it.
 */
final readonly class UpdateTaskScopes
{
  public function __construct(
    private ResolvedScope $channel,
  ) {
  }

  /**
   * The scope 'channel': its id and the value its resolver loaded.
   */
  public function channel(): ResolvedScope
  {
    return $this->channel;
  }
}

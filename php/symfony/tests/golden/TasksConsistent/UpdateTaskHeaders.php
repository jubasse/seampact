<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The headers parameters of operation 'updateTask'.
 */
final readonly class UpdateTaskHeaders
{
  public function __construct(
    public string $idempotencyKey,
  ) {
  }
}

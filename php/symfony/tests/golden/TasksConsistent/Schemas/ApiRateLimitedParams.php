<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'ApiRateLimitedParams'.
 */
final readonly class ApiRateLimitedParams
{
  public function __construct(
    public int $retryAfterMs,
  ) {
  }
}

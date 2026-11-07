<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'ApiRateLimitedParams'.
 */
final readonly class ApiRateLimitedParams
{
  public function __construct(
    #[Assert\NotNull, Assert\GreaterThanOrEqual(value: 0), Assert\LessThanOrEqual(value: 9007199254740991)]
    public int $retryAfterMs,
  ) {
  }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\ApiRateLimitedParams;

/**
 * The error 'api.rate_limited'.
 */
final class ApiRateLimitedError extends TasksContractException
{
  public const CODE = 'api.rate_limited';
  public const STATUS = 429;

  public function __construct(
    public readonly ApiRateLimitedParams $params,
  ) {
    parent::__construct(self::CODE);
  }

  public function contractCode(): string
  {
    return self::CODE;
  }

  public function status(): int
  {
    return self::STATUS;
  }
}

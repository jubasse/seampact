<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'api.idempotency_key_reused'.
 */
final class ApiIdempotencyKeyReusedError extends TasksContractException
{
  public const CODE = 'api.idempotency_key_reused';
  public const STATUS = 422;

  public function __construct()
  {
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

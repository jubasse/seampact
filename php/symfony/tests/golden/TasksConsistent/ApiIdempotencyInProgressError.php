<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'api.idempotency_in_progress'.
 */
final class ApiIdempotencyInProgressError extends TasksContractException
{
  public const CODE = 'api.idempotency_in_progress';
  public const STATUS = 409;

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

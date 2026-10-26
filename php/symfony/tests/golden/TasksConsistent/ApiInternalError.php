<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'api.internal'.
 */
final class ApiInternalError extends TasksContractException
{
  public const CODE = 'api.internal';
  public const STATUS = 500;

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

<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'state.conflict'.
 */
final class StateConflictError extends TasksContractException
{
  public const CODE = 'state.conflict';
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

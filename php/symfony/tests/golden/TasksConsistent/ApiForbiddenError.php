<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\ApiForbiddenParams;

/**
 * The error 'api.forbidden'.
 */
final class ApiForbiddenError extends TasksContractException
{
  public const CODE = 'api.forbidden';
  public const STATUS = 403;

  public function __construct(
    public readonly ApiForbiddenParams $params,
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

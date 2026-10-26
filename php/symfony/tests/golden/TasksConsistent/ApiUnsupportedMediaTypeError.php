<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The error 'api.unsupported_media_type'.
 */
final class ApiUnsupportedMediaTypeError extends TasksContractException
{
  public const CODE = 'api.unsupported_media_type';
  public const STATUS = 415;

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

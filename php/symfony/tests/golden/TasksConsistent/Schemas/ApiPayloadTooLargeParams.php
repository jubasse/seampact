<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'ApiPayloadTooLargeParams'.
 */
final readonly class ApiPayloadTooLargeParams
{
  public function __construct(
    #[Assert\GreaterThanOrEqual(value: 0)]
    public ?int $limitBytes,
  ) {
  }
}

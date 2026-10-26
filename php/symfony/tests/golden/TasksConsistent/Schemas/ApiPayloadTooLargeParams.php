<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'ApiPayloadTooLargeParams'.
 */
final readonly class ApiPayloadTooLargeParams
{
  public function __construct(
    public ?int $limitBytes,
  ) {
  }
}

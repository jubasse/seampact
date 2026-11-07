<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'ApiForbiddenParams'.
 */
final readonly class ApiForbiddenParams
{
  public function __construct(
    public ?string $pointer,
  ) {
  }
}

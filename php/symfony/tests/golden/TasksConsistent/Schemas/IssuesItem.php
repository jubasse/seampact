<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'IssuesItem'.
 */
final readonly class IssuesItem
{
  public function __construct(
    public string $pointer,
    public string $rule,
  ) {
  }
}

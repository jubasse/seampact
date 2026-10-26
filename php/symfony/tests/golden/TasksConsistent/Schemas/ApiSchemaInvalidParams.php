<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'ApiSchemaInvalidParams'.
 */
final readonly class ApiSchemaInvalidParams
{
  /**
   * @param list<IssuesItem> $issues
   */
  public function __construct(
    public array $issues,
  ) {
  }
}

<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\ApiSchemaInvalidParams;

/**
 * A declared error of operation 'health', returned by its handler instead of thrown.
 */
final readonly class HealthErrors implements HealthResult
{
  private function __construct(
    public string $code,
    public ?object $params,
  ) {
  }

  public static function apiSchemaInvalid(ApiSchemaInvalidParams $params): self
  {
    return new self('api.schema_invalid', $params);
  }

  public static function apiInternal(): self
  {
    return new self('api.internal', null);
  }
}

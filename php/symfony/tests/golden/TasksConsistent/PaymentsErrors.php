<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\ApiPayloadTooLargeParams;
use Seampact\Golden\TasksConsistent\Schemas\ApiSchemaInvalidParams;

/**
 * A declared error of operation 'payments', returned by its handler instead of thrown.
 */
final readonly class PaymentsErrors implements PaymentsResult
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

  public static function apiUnauthenticated(): self
  {
    return new self('api.unauthenticated', null);
  }

  public static function apiPayloadTooLarge(ApiPayloadTooLargeParams $params): self
  {
    return new self('api.payload_too_large', $params);
  }

  public static function apiUnsupportedMediaType(): self
  {
    return new self('api.unsupported_media_type', null);
  }

  public static function apiInternal(): self
  {
    return new self('api.internal', null);
  }
}

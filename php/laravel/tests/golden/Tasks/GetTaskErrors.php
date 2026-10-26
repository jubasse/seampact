<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\ApiSchemaInvalidParams;

/**
 * A declared error of operation 'getTask', returned by its handler instead of thrown.
 */
final readonly class GetTaskErrors implements GetTaskResult
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

    public static function apiNotFound(): self
    {
        return new self('api.not_found', null);
    }

    public static function apiInternal(): self
    {
        return new self('api.internal', null);
    }
}

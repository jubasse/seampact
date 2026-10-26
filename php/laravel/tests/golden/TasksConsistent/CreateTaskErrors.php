<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Replies;
use Seampact\Golden\TasksConsistent\Schemas\ApiForbiddenParams;
use Seampact\Golden\TasksConsistent\Schemas\ApiPayloadTooLargeParams;
use Seampact\Golden\TasksConsistent\Schemas\ApiRateLimitedParams;
use Seampact\Golden\TasksConsistent\Schemas\ApiSchemaInvalidParams;
use Symfony\Component\HttpFoundation\Response;

/**
 * A declared error of operation 'createTask', returned by its handler instead of thrown.
 */
final readonly class CreateTaskErrors implements CreateTaskResult, Responsable
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

    public static function apiCsrfInvalid(): self
    {
        return new self('api.csrf_invalid', null);
    }

    public static function apiForbidden(ApiForbiddenParams $params): self
    {
        return new self('api.forbidden', $params);
    }

    public static function apiNotFound(): self
    {
        return new self('api.not_found', null);
    }

    public static function apiIdempotencyInProgress(): self
    {
        return new self('api.idempotency_in_progress', null);
    }

    public static function apiPayloadTooLarge(ApiPayloadTooLargeParams $params): self
    {
        return new self('api.payload_too_large', $params);
    }

    public static function apiUnsupportedMediaType(): self
    {
        return new self('api.unsupported_media_type', null);
    }

    public static function apiIdempotencyKeyReused(): self
    {
        return new self('api.idempotency_key_reused', null);
    }

    public static function apiRateLimited(ApiRateLimitedParams $params): self
    {
        return new self('api.rate_limited', $params);
    }

    public static function apiInternal(): self
    {
        return new self('api.internal', null);
    }

    /**
     * @param Request $request
     */
    public function toResponse($request): Response
    {
        return Replies::result($request, 'tasks', $this);
    }
}

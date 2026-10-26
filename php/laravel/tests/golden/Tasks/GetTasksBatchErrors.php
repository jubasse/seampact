<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Golden\Tasks\Laravel\Runtime\Replies;
use Seampact\Golden\Tasks\Schemas\ApiPayloadTooLargeParams;
use Seampact\Golden\Tasks\Schemas\ApiSchemaInvalidParams;
use Symfony\Component\HttpFoundation\Response;

/**
 * A declared error of operation 'getTasksBatch', returned by its handler instead of thrown.
 */
final readonly class GetTasksBatchErrors implements GetTasksBatchResult, Responsable
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

    /**
     * @param Request $request
     */
    public function toResponse($request): Response
    {
        return Replies::result($request, 'tasks', $this);
    }
}

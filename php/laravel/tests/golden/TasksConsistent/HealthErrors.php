<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Golden\TasksConsistent\Schemas\ApiSchemaInvalidParams;
use Symfony\Component\HttpFoundation\Response;

/**
 * A declared error of operation 'health', returned by its handler instead of thrown.
 */
final readonly class HealthErrors implements HealthResult, Responsable
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

    /**
     * @param Request $request
     */
    public function toResponse($request): Response
    {
        return Replies::result($request, 'tasks', $this);
    }
}

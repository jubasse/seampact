<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Replies;
use Seampact\Golden\TasksConsistent\Schemas\Health;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 200 reply of operation 'health'.
 */
final readonly class HealthResponse200 implements HealthResult, Responsable
{
    public function __construct(
        public Health $body,
    ) {
    }

    /**
     * @param Request $request
     */
    public function toResponse($request): Response
    {
        return Replies::result($request, 'tasks', $this);
    }
}

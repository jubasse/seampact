<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Golden\Tasks\Schemas\Health;
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

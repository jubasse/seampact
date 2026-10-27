<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Golden\Tasks\Schemas\Draft;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 200 reply of operation 'getDraft'.
 */
final readonly class GetDraftResponse200 implements GetDraftResult, Responsable
{
    public function __construct(
        public Draft $body,
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

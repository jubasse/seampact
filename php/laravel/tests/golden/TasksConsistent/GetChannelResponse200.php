<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Golden\TasksConsistent\Schemas\Channel;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 200 reply of operation 'getChannel'.
 */
final readonly class GetChannelResponse200 implements GetChannelResult, Responsable
{
    public function __construct(
        public Channel $body,
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

<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Golden\Tasks\Laravel\Runtime\Replies;
use Seampact\Golden\Tasks\Schemas\Channel;
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

<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Golden\Tasks\Laravel\Runtime\Replies;
use Seampact\Golden\Tasks\Schemas\Task;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 200 reply of operation 'getTask'.
 */
final readonly class GetTaskResponse200 implements GetTaskResult, Responsable
{
    public function __construct(
        public Task $body,
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

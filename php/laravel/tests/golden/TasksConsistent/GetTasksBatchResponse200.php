<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Golden\TasksConsistent\Schemas\Task;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 200 reply of operation 'getTasksBatch'.
 */
final readonly class GetTasksBatchResponse200 implements GetTasksBatchResult, Responsable
{
    /**
     * @param array<string, Task> $body
     */
    public function __construct(
        public array $body,
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

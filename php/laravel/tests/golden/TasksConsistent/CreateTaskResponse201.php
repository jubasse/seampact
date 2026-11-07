<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Golden\TasksConsistent\Schemas\Task;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 201 reply of operation 'createTask'.
 */
final readonly class CreateTaskResponse201 implements CreateTaskResult, Responsable
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

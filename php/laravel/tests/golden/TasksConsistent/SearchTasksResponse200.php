<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Replies;
use Seampact\Golden\TasksConsistent\Schemas\TaskSearchResult;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 200 reply of operation 'searchTasks'.
 */
final readonly class SearchTasksResponse200 implements SearchTasksResult, Responsable
{
    public function __construct(
        public TaskSearchResult $body,
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

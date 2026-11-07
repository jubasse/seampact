<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 204 reply of operation 'purgeTask'.
 */
final readonly class PurgeTaskResponse204 implements PurgeTaskResult, Responsable
{
    /**
     * @param Request $request
     */
    public function toResponse($request): Response
    {
        return Replies::result($request, 'tasks', $this);
    }
}

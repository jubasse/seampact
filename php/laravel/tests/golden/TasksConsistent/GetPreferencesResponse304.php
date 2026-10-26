<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Replies;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 304 reply of operation 'getPreferences'.
 */
final readonly class GetPreferencesResponse304 implements GetPreferencesResult, Responsable
{
    /**
     * @param Request $request
     */
    public function toResponse($request): Response
    {
        return Replies::result($request, 'tasks', $this);
    }
}

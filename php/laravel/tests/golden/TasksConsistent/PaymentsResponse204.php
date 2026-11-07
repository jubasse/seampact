<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\Replies;
use Symfony\Component\HttpFoundation\Response;

/**
 * The 204 reply of operation 'payments'.
 */
final readonly class PaymentsResponse204 implements PaymentsResult, Responsable
{
    /**
     * @param Request $request
     */
    public function toResponse($request): Response
    {
        return Replies::result($request, 'tasks', $this);
    }
}

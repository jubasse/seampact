<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Debug\ShouldntReport;
use Illuminate\Http\Request;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Replies;
use Symfony\Component\HttpFoundation\Response;

/**
 * A declared error of api 'tasks', thrown by a handler.
 */
abstract class TasksContractException extends \RuntimeException implements ShouldntReport
{
    abstract public function contractCode(): string;

    abstract public function status(): int;

    /**
     * The params of the error, null when its code declares none.
     */
    public function contractParams(): ?object
    {
        return null;
    }

    /**
     * The reply Laravel's exception handler writes: the error in the api's format.
     */
    public function render(Request $request): Response
    {
        return Replies::thrown($request, 'tasks', $this->contractCode(), $this->contractParams());
    }
}

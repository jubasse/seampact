<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Response;

/**
 * The stored reply of an idempotent write, replayed in place of the handler: thrown by the FormRequest once the store
 * answers a replay, and rendered by its own `render()`, which Laravel's handler calls before any render callback.
 */
final class ReplayedReply extends \RuntimeException
{
    public function __construct(private readonly Response $reply)
    {
        parent::__construct('seampact: the stored reply of an idempotent write is replayed.');
    }

    public function render(): Response
    {
        return $this->reply;
    }
}

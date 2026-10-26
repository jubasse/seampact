<?php

declare(strict_types=1);

namespace App\Suite;

use Illuminate\Http\JsonResponse;

/** A scripted reply the result type cannot hold, which the app writes itself through Laravel's exception handler. */
final class ScriptedReply extends \RuntimeException
{
    public function __construct(private readonly int $replyStatus, private readonly string $errorCode, private readonly mixed $replyBody)
    {
        parent::__construct("scripted reply {$replyStatus}");
    }

    public function render(): JsonResponse
    {
        if ($this->errorCode === '') {
            return new JsonResponse($this->replyBody, $this->replyStatus);
        }

        return new JsonResponse(['code' => $this->errorCode, 'status' => $this->replyStatus], $this->replyStatus, ['Content-Type' => 'application/problem+json']);
    }
}

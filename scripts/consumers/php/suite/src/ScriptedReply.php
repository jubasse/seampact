<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

/**
 * A scripted reply the result type cannot hold, which each app writes itself through its framework's exception
 * handling, from the status, headers and body this carries.
 */
final class ScriptedReply extends \RuntimeException
{
    public function __construct(private readonly int $replyStatus, private readonly string $errorCode, private readonly mixed $replyBody)
    {
        parent::__construct("scripted reply {$replyStatus}");
    }

    public function status(): int
    {
        return $this->replyStatus;
    }

    public function body(): mixed
    {
        return $this->errorCode === '' ? $this->replyBody : ['code' => $this->errorCode, 'status' => $this->replyStatus];
    }

    /** @return array<string, string> */
    public function headers(): array
    {
        return $this->errorCode === '' ? [] : ['Content-Type' => 'application/problem+json'];
    }
}

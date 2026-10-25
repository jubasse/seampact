<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** Where the boundary keeps idempotency keys and the responses to replay; the application provides it. */
interface IdempotencyStore
{
    /** Claims the key, or says why the write does not run. */
    public function begin(IdempotencyClaim $claim): IdempotencyBegin;

    /** Stores the response of the write that claimed the key. */
    public function complete(string $key, StoredResponse $response): void;

    /** Releases the key of a write that failed, so a retry runs again. */
    public function abandon(string $key): void;
}

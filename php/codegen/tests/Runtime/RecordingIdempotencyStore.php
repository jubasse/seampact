<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\StoredResponse;

/** An idempotency store that answers what the test scripts, records what it is given, and fails on demand. */
final class RecordingIdempotencyStore implements IdempotencyStore
{
    public ?IdempotencyBegin $answer = null;
    public bool $failOnComplete = false;
    public bool $failOnAbandon = false;
    /** @var list<IdempotencyClaim> */
    public array $claims = [];
    /** @var array<string, StoredResponse> */
    public array $completed = [];
    /** @var list<string> */
    public array $abandoned = [];

    public function begin(IdempotencyClaim $claim): IdempotencyBegin
    {
        $this->claims[] = $claim;

        return $this->answer ?? new IdempotencyBegin\Started();
    }

    public function complete(string $key, StoredResponse $response): void
    {
        if ($this->failOnComplete) {
            throw new \RuntimeException('store unreachable');
        }
        $this->completed[$key] = $response;
    }

    public function abandon(string $key): void
    {
        if ($this->failOnAbandon) {
            throw new \RuntimeException('store unreachable');
        }
        $this->abandoned[] = $key;
    }
}

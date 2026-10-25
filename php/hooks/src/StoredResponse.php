<?php

declare(strict_types=1);

namespace Seampact\Hooks;

use Seampact\Hooks\StoredResponse\Header;

/** The response an idempotent write answered, kept to be replayed; its body never reaches a debug dump. */
final readonly class StoredResponse
{
    /**
     * @param list<Header> $headers
     */
    public function __construct(
        public int $status,
        public array $headers,
        public string $body,
    ) {
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return [
            'status' => $this->status,
            'headers' => $this->headers,
            'body' => Redaction::REDACTED,
        ];
    }
}

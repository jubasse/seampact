<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** A read-only view of the request a hook is called for; its headers never reach a debug dump. */
final readonly class RequestView
{
    /**
     * @param array<string, list<string>> $headers every header by lower-case name, each with its values in order
     */
    public function __construct(
        public string $method,
        public string $path,
        public array $headers,
        public ?string $clientAddress = null,
    ) {
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return [
            'method' => $this->method,
            'path' => $this->path,
            'headers' => Redaction::REDACTED,
            'clientAddress' => $this->clientAddress,
        ];
    }
}

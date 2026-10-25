<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** A request signed by an application scheme (`verify: application`): the hook verifies the header itself. */
final readonly class SignedApplicationRequest implements SignedRequest
{
    /**
     * @param string $rawBody the decoded body bytes, exactly as received
     * @param array<string, string> $headers the headers the scheme declares, by name
     */
    public function __construct(
        public string $rawBody,
        public string $signatureHeader,
        public array $headers,
        public ?string $keyId = null,
    ) {
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return [
            'rawBody' => Redaction::REDACTED,
            'signatureHeader' => Redaction::REDACTED,
            'headers' => Redaction::REDACTED,
            'keyId' => $this->keyId,
        ];
    }
}

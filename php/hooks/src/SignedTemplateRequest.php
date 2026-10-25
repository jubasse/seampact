<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** A request signed by a template scheme: the raw body and the fields the boundary parsed from the header. */
final readonly class SignedTemplateRequest implements SignedRequest
{
    /**
     * @param string $rawBody the decoded body bytes, exactly as received
     * @param list<string> $candidateSignatures every signature the header carries, still encoded
     * @param string|null $timestamp the signed timestamp text as received, when the format has one
     */
    public function __construct(
        public string $rawBody,
        public array $candidateSignatures,
        public string $keyId,
        public SignatureTemplate $template,
        public ?string $timestamp = null,
    ) {
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return [
            'rawBody' => Redaction::REDACTED,
            'timestamp' => $this->timestamp,
            'candidateSignatures' => Redaction::REDACTED,
            'keyId' => $this->keyId,
            'template' => $this->template,
        ];
    }
}

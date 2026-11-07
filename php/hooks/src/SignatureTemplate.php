<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** A template signature scheme (ADR 0013): the MAC algorithm, the signed payload template and the encoding. */
final readonly class SignatureTemplate
{
    /**
     * @param string $payload the signed payload, with `{ts}` and `{rawBody}` placeholders
     * @param int|null $toleranceMs the largest distance allowed between the signed timestamp and now
     */
    public function __construct(
        public string $algorithm,
        public string $payload,
        public SignatureEncoding $encoding,
        public ?int $toleranceMs = null,
    ) {
    }
}

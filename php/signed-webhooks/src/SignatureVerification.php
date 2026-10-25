<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The verifier's answer: verified, or the failure that refused the request. */
final readonly class SignatureVerification
{
    private function __construct(public ?SignatureFailure $failure)
    {
    }

    public static function verified(): self
    {
        return new self(null);
    }

    public static function failed(SignatureFailure $failure): self
    {
        return new self($failure);
    }

    public function isVerified(): bool
    {
        return $this->failure === null;
    }
}

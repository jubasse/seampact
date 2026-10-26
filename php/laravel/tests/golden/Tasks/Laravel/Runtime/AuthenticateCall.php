<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\OperationRef;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\SignedRequest;

/** What an authenticate hook receives: the identity's generated credentials class holds the values found. */
final readonly class AuthenticateCall implements AuthenticateRequest
{
    public function __construct(
        private string $identity,
        #[\SensitiveParameter] private object $credentials,
        #[\SensitiveParameter] private ?string $csrfToken,
        private RequestView $request,
        private OperationRef $operation,
    ) {
    }

    public function identity(): string
    {
        return $this->identity;
    }

    public function credentials(): object
    {
        return $this->credentials;
    }

    public function csrfToken(): ?string
    {
        return $this->csrfToken;
    }

    public function signature(): ?SignedRequest
    {
        return null;
    }

    public function request(): RequestView
    {
        return $this->request;
    }

    public function operation(): OperationRef
    {
        return $this->operation;
    }

    public function extensions(): object
    {
        return new \stdClass();
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['identity' => $this->identity, 'credentials' => \Seampact\Hooks\Redaction::REDACTED, 'operation' => $this->operation];
    }
}

<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The signed payload does not hold `{rawBody}` exactly once and `{ts}` at most once: a captured signature could pass with another body. */
final class SignaturePayloadInvalid extends \DomainException
{
    public const CODE = 'signature.payload.invalid';

    public function __construct(public readonly string $payload)
    {
        parent::__construct(sprintf(
            "The signed payload '%s' must hold {rawBody} exactly once and {ts} at most once, or a captured signature could pass with another body. Copy the payload of the hook's signature template.",
            $payload,
        ));
    }
}

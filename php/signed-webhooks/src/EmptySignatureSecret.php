<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The lookup returned an empty secret: anyone can compute a MAC with it, so the check fails closed. */
final class EmptySignatureSecret extends \DomainException
{
    public const CODE = 'signature.secret.empty';

    public function __construct(public readonly string $keyId)
    {
        parent::__construct(sprintf(
            "The secret looked up for the key '%s' is empty, so any request could pass. Configure the secret (check the environment variable behind the lookup).",
            $keyId,
        ));
    }
}

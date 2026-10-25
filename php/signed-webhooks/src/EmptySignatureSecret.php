<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/**
 * The lookup returned an empty secret, or a value that is not a string (an unset environment variable): anyone can
 * compute a MAC with an empty secret, so the check fails closed. The message names the key id and the position in
 * the list, never a secret.
 */
final class EmptySignatureSecret extends \DomainException
{
    public const CODE = 'signature.secret.empty';

    public function __construct(public readonly string $keyId, public readonly int $index)
    {
        parent::__construct(sprintf(
            "The secret at position %d looked up for the key '%s' is empty or not a string, so any request could pass. Configure the secret (check the environment variable behind the lookup).",
            $index,
            $keyId,
        ));
    }
}

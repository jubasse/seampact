<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The secrets currently valid for a key id: one, or several during a rotation. The verifier never keeps them. */
interface SecretLookup
{
    /** @return list<string> the secret bytes, none when the key id is unknown */
    public function secretsFor(string $keyId): array;
}

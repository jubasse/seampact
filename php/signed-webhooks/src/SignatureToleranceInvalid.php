<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The tolerance is negative, which refuses every request, or is given for a payload that signs no `{ts}`. */
final class SignatureToleranceInvalid extends \DomainException
{
    public const CODE = 'signature.tolerance.invalid';

    public static function negative(int $toleranceMs): self
    {
        return new self(sprintf(
            "The tolerance %d ms is negative, so every request would fail. Pass the tolerance of the hook's signature template as toleranceMs.",
            $toleranceMs,
        ));
    }

    public static function withoutTimestamp(string $payload): self
    {
        return new self(sprintf(
            "The scheme has a tolerance but its signed payload '%s' holds no {ts}, so there is no timestamp to check. Drop the tolerance, as the hook's signature template does.",
            $payload,
        ));
    }
}

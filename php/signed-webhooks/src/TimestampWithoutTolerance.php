<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The scheme signs `{ts}` without a tolerance (ADR 0013 requires one): a replay of any age would pass. */
final class TimestampWithoutTolerance extends \DomainException
{
    public const CODE = 'signature.tolerance.missing';

    public function __construct(public readonly string $payload)
    {
        parent::__construct(sprintf(
            "The signed payload '%s' holds {ts} but the scheme has no tolerance, so a replayed request of any age would pass. Pass the tolerance of the hook's signature template as toleranceMs.",
            $payload,
        ));
    }
}

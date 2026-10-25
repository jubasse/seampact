<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The scheme names an algorithm this verifier does not compute: a contract it cannot verify. */
final class UnsupportedSignatureAlgorithm extends \DomainException
{
    public const CODE = 'signature.algorithm.unsupported';

    public function __construct(public readonly string $algorithm)
    {
        parent::__construct(sprintf(
            "The signature algorithm '%s' is not one seampact/signed-webhooks computes; it computes '%s'. Verify this scheme with 'verify: application', or update the package to a release that computes it.",
            $algorithm,
            TemplateSignatureVerifier::SUPPORTED_ALGORITHM,
        ));
    }
}

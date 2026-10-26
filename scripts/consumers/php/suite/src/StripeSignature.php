<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

use Seampact\Hooks\SignedTemplateRequest;
use Seampact\SignedWebhooks\SecretLookup;
use Seampact\SignedWebhooks\SignatureEncoding;
use Seampact\SignedWebhooks\SignatureScheme;
use Seampact\SignedWebhooks\TemplateSignatureVerifier;

/**
 * The `stripe` identity's check: `seampact/signed-webhooks` verifies the signature over the raw body with the suite's
 * `stripeSecret`, the one secret of the key id `stripe`.
 */
final class StripeSignature implements SecretLookup
{
    /** The account the verified sender is. */
    public const ACCOUNT = 'acct_seampact';
    private const KEY_ID = 'stripe';

    public static function verified(?SignedTemplateRequest $signed): bool
    {
        if ($signed === null) {
            return false;
        }

        $template = $signed->template;
        $scheme = new SignatureScheme($template->algorithm, $template->payload, SignatureEncoding::from($template->encoding->value), $template->toleranceMs);

        return (new TemplateSignatureVerifier(new self()))
            ->verify($signed->rawBody, $signed->timestamp, $signed->candidateSignatures, $signed->keyId, $scheme)
            ->isVerified();
    }

    public function secretsFor(string $keyId): array
    {
        return $keyId === self::KEY_ID ? [Credentials::text('stripeSecret')] : [];
    }
}

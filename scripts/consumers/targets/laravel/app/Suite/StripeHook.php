<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\Runtime\Denial;
use App\Generated\Tasks\Laravel\StripeAuthenticateHook;
use App\Generated\Tasks\Laravel\StripePrincipal;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;
use Seampact\Hooks\SignedTemplateRequest;
use Seampact\SignedWebhooks\SecretLookup;
use Seampact\SignedWebhooks\SignatureEncoding;
use Seampact\SignedWebhooks\SignatureScheme;
use Seampact\SignedWebhooks\TemplateSignatureVerifier;

/**
 * The `stripe` identity's hook: `seampact/signed-webhooks` verifies the signature over the raw body with the suite's
 * `stripeSecret`, the one secret of the key id `stripe`.
 */
final class StripeHook implements StripeAuthenticateHook, SecretLookup
{
    private const KEY_ID = 'stripe';
    private const ACCOUNT = 'acct_seampact';

    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:stripe', $request->operation()->api, $request->operation()->id);

        $signed = $request->signature();
        $verified = $signed instanceof SignedTemplateRequest && $this->verified($signed);

        return $verified
            ? new AuthenticateResult\Authenticated(new StripePrincipal(self::ACCOUNT))
            : new AuthenticateResult\Denied(new Denial('api.unauthenticated'));
    }

    public function secretsFor(string $keyId): array
    {
        return $keyId === self::KEY_ID ? [Credentials::text('stripeSecret')] : [];
    }

    private function verified(SignedTemplateRequest $signed): bool
    {
        $template = $signed->template;
        $scheme = new SignatureScheme($template->algorithm, $template->payload, SignatureEncoding::from($template->encoding->value), $template->toleranceMs);

        return (new TemplateSignatureVerifier($this))
            ->verify($signed->rawBody, $signed->timestamp, $signed->candidateSignatures, $signed->keyId, $scheme)
            ->isVerified();
    }
}

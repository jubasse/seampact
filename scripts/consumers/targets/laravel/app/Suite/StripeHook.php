<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\StripeAuthenticateHook;
use App\Generated\Tasks\Laravel\StripePrincipal;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\StripeSignature;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;
use Seampact\Hooks\SignedTemplateRequest;

/** The `stripe` identity's hook: the shared suite check verifies the signature over the raw body. */
final class StripeHook implements StripeAuthenticateHook
{
    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:stripe', $request->operation()->api, $request->operation()->id);
        $signed = $request->signature();

        return StripeSignature::verified($signed instanceof SignedTemplateRequest ? $signed : null)
            ? new AuthenticateResult\Authenticated(new StripePrincipal(StripeSignature::ACCOUNT))
            : new AuthenticateResult\Denied(new Denial('api.unauthenticated'));
    }
}

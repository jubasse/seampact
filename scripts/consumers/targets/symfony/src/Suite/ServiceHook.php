<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksService\Schemas\Service;
use App\Generated\TasksService\Symfony\ServiceAuthenticateHook;
use App\Generated\TasksService\Symfony\ServiceCredentials;
use App\Generated\TasksService\Symfony\ServicePrincipal;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\ServiceTokens;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/** The `tasksService` api's `service` identity double: one of the fixed service JWTs, accepted as is. */
final class ServiceHook implements ServiceAuthenticateHook
{
    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:service', $request->operation()->api, $request->operation()->id);

        $credentials = $request->credentials();
        $serviceName = ServiceTokens::serviceNameOf($credentials instanceof ServiceCredentials ? $credentials->internalToken : null);
        $service = $serviceName === null ? null : Service::from($serviceName);

        return $service === null
            ? new AuthenticateResult\Denied(new Denial('api.unauthenticated'))
            : new AuthenticateResult\Authenticated(new ServicePrincipal($service, Credentials::text('userId')));
    }
}

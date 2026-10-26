<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksService\Laravel\Runtime\Denial;
use App\Generated\TasksService\Laravel\ServiceAuthenticateHook;
use App\Generated\TasksService\Laravel\ServiceCredentials;
use App\Generated\TasksService\Laravel\ServicePrincipal;
use App\Generated\TasksService\Schemas\Service;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/** The `tasksService` api's `service` identity double: one of the fixed service JWTs, accepted as is. */
final class ServiceHook implements ServiceAuthenticateHook
{
    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:service', $request->operation()->api, $request->operation()->id);

        $services = [
            Credentials::text('serviceJwt') => Service::from(Credentials::text('serviceName')),
            Credentials::text('foreignServiceJwt') => Service::from(Credentials::text('foreignServiceName')),
        ];
        $credentials = $request->credentials();
        $token = $credentials instanceof ServiceCredentials ? $credentials->internalToken : null;
        $service = $token === null ? null : ($services[$token] ?? null);

        return $service === null
            ? new AuthenticateResult\Denied(new Denial('api.unauthenticated'))
            : new AuthenticateResult\Authenticated(new ServicePrincipal($service, Credentials::text('userId')));
    }
}

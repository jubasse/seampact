<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksService\Schemas\Service;
use App\Generated\TasksService\Symfony\ServiceAuthenticateHook;
use App\Generated\TasksService\Symfony\ServiceCredentials;
use App\Generated\TasksService\Symfony\ServicePrincipal;
use App\Generated\TasksServiceWrites\Schemas\Service as WritesService;
use App\Generated\TasksServiceWrites\Symfony\ServiceAuthenticateHook as WritesServiceAuthenticateHook;
use App\Generated\TasksServiceWrites\Symfony\ServiceCredentials as WritesServiceCredentials;
use App\Generated\TasksServiceWrites\Symfony\ServicePrincipal as WritesServicePrincipal;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\ServiceTokens;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/** The `service` identity double of the `tasksService` and `tasksServiceWrites` apis: one of the fixed service JWTs, accepted as is. */
final class ServiceHook implements ServiceAuthenticateHook, WritesServiceAuthenticateHook
{
    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:service', $request->operation()->api, $request->operation()->id);

        $credentials = $request->credentials();
        $isServiceCredentials = $credentials instanceof ServiceCredentials || $credentials instanceof WritesServiceCredentials;
        $serviceName = ServiceTokens::serviceNameOf($isServiceCredentials ? $credentials->internalToken : null);
        if ($serviceName === null) {
            return new AuthenticateResult\Denied(new Denial('api.unauthenticated'));
        }

        $userId = Credentials::text('userId');

        return new AuthenticateResult\Authenticated($credentials instanceof WritesServiceCredentials
            ? new WritesServicePrincipal(WritesService::from($serviceName), $userId)
            : new ServicePrincipal(Service::from($serviceName), $userId));
    }
}

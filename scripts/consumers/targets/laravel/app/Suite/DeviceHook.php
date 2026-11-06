<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksDevices\Laravel\DeviceAuthenticateHook;
use App\Generated\TasksDevices\Laravel\DeviceCredentials;
use App\Generated\TasksDevices\Laravel\DevicePrincipal;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/** The `tasksDevices` api's `device` identity double: the paired device's token, accepted as is. */
final class DeviceHook implements DeviceAuthenticateHook
{
    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:device', $request->operation()->api, $request->operation()->id);

        $credentials = $request->credentials();
        $paired = $credentials instanceof DeviceCredentials && $credentials->deviceToken === Credentials::text('deviceToken');

        return $paired
            ? new AuthenticateResult\Authenticated(new DevicePrincipal(Credentials::text('deviceId')))
            : new AuthenticateResult\Denied(new Denial('api.unauthenticated'));
    }
}

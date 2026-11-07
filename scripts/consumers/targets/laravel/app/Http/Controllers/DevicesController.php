<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksDevices\DevicesEndpoints;
use App\Generated\TasksDevices\Schemas\DeviceStatus;
use App\Generated\TasksDevices\StatusRequest;
use App\Generated\TasksDevices\StatusResponse200;
use App\Generated\TasksDevices\StatusResult;

/** The `tasksDevices` api's controller: the status of the device the boundary authenticated. */
final class DevicesController implements DevicesEndpoints
{
    public function status(StatusRequest $request): StatusResult
    {
        return new StatusResponse200(new DeviceStatus($request->principal()->deviceId));
    }
}

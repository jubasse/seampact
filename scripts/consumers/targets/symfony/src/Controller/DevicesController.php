<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksDevices\DevicesEndpoints;
use App\Generated\TasksDevices\Schemas\DeviceStatus;
use App\Generated\TasksDevices\StatusInput;
use App\Generated\TasksDevices\StatusResponse200;
use App\Generated\TasksDevices\StatusResult;
use App\Generated\TasksDevices\Symfony\SeampactOperation;

/** The `tasksDevices` api's controller: the status of the device the boundary authenticated. */
final class DevicesController implements DevicesEndpoints
{
    #[SeampactOperation('status')]
    public function status(StatusInput $input): StatusResult
    {
        return new StatusResponse200(new DeviceStatus($input->principal()->deviceId));
    }
}

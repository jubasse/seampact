package com.example.consumer;

import com.example.tasksdevices.api.DevicesEndpoints;
import com.example.tasksdevices.api.StatusInput;
import com.example.tasksdevices.api.StatusResult;
import com.example.tasksdevices.api.schemas.DeviceStatus;
import com.example.tasksdevices.api.spring.Status;
import org.springframework.web.bind.annotation.RestController;

/** The `tasksDevices` api's controller: the status of the device the boundary authenticated. */
@RestController
final class TasksDevicesControllers implements DevicesEndpoints {
    @Override
    @Status
    public StatusResult status(StatusInput input) {
        return new StatusResult.Status200(new DeviceStatus(input.principal().deviceId()));
    }
}

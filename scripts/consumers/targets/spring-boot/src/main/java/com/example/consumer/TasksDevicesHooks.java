package com.example.consumer;

import com.example.tasksdevices.api.DeviceAuthenticateHook;
import com.example.tasksdevices.api.DeviceAuthenticateRequest;
import com.example.tasksdevices.api.TasksDevicesUnexpectedErrorListener;
import com.example.tasksdevices.api.schemas.DevicePrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The `tasksDevices` api's hook doubles. */
final class TasksDevicesHooks {
    private static final String API = "tasksDevices";

    private TasksDevicesHooks() {}

    /** The `device` identity: the paired device's token, accepted as is. */
    @Component
    static final class DeviceHook implements DeviceAuthenticateHook {
        @Override
        public AuthenticateResult<DevicePrincipal, Denial> authenticate(DeviceAuthenticateRequest request) {
            SuiteControl.recordHookCall("authenticate:device", API, request.operation().id());

            boolean paired = request.credentials().deviceToken().orElse("").equals(Credentials.text("deviceToken"));

            return paired
                    ? new AuthenticateResult.Authenticated<>(new DevicePrincipal(UUID.fromString(Credentials.text("deviceId"))))
                    : new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated"));
        }
    }

    @Component
    static final class TasksDevicesUnexpectedErrors implements TasksDevicesUnexpectedErrorListener {
        @Override
        public void onUnexpectedError(UnexpectedFailure failure) {
            UnexpectedFailures.log(failure.api(), failure.operation(), failure.reason(), failure.cause());
        }
    }
}

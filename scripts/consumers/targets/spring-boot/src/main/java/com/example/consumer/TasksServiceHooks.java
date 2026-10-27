package com.example.consumer;

import com.example.tasksservice.api.ServiceAuthenticateHook;
import com.example.tasksservice.api.ServiceAuthenticateRequest;
import com.example.tasksservice.api.TasksServiceDecider;
import com.example.tasksservice.api.TasksServiceUnexpectedErrorListener;
import com.example.tasksservice.api.schemas.Service;
import com.example.tasksservice.api.schemas.ServicePrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import io.github.jubasse.seampact.springboot.runtime.RequirementCall;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** The `tasksService` api's hook doubles. */
final class TasksServiceHooks {
    private static final String API = "tasksService";
    private static final String CALLER_SERVICE_RIGHT = "callerService";

    private TasksServiceHooks() {}

    /** The `service` identity: one of the fixed service JWTs, accepted as is. */
    @Component
    static final class ServiceHook implements ServiceAuthenticateHook {
        private static final Map<String, Service> SERVICES = Map.of(
                Credentials.text("serviceJwt"), Service.valueOf(Credentials.text("serviceName").toUpperCase(java.util.Locale.ROOT)),
                Credentials.text("foreignServiceJwt"), Service.valueOf(Credentials.text("foreignServiceName").toUpperCase(java.util.Locale.ROOT)));

        @Override
        public AuthenticateResult<ServicePrincipal, Denial> authenticate(ServiceAuthenticateRequest request) {
            SuiteControl.recordHookCall("authenticate:service", API, request.operation().id());

            Service service = SERVICES.get(request.credentials().internalToken().orElse(""));

            return service == null
                    ? new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated"))
                    : new AuthenticateResult.Authenticated<>(new ServicePrincipal(service, UUID.fromString(Credentials.text("userId"))));
        }
    }

    /** Denies what the script denies, else `callerService` for a service its params do not list. */
    @Component
    static final class ServiceDecider implements TasksServiceDecider {
        @Override
        public Set<String> names() {
            return Set.of(EVERY_NAME);
        }

        @Override
        public Decision<Denial> decide(RequirementCall request) {
            SuiteControl.recordHookCall("decide:" + request.name(), API, request.operation().id());

            Optional<String> denied = SuiteControl.scriptedDecision(request.name(), Purposes.nameOf(request.purpose()));
            if (denied.isPresent()) return new Decision.Denied<>(Denial.of(denied.get()));

            if (CALLER_SERVICE_RIGHT.equals(request.name()) && !callerAllowed(request)) {
                return new Decision.Denied<>(Denial.of("api.forbidden", Map.of()));
            }

            return new Decision.Allowed<>();
        }

        private static boolean callerAllowed(RequirementCall request) {
            if (!(request.principal() instanceof ServicePrincipal principal)) return false;

            for (JsonNode allowed : request.params().map(params -> params.path("allowed")).orElse(tools.jackson.databind.node.MissingNode.getInstance())) {
                if (allowed.asString().equals(principal.service().toString().toLowerCase(java.util.Locale.ROOT))) return true;
            }

            return false;
        }
    }

    @Component
    static final class TasksServiceUnexpectedErrors implements TasksServiceUnexpectedErrorListener {
        @Override
        public void onUnexpectedError(UnexpectedFailure failure) {
            UnexpectedFailures.log(failure.api(), failure.operation(), failure.reason(), failure.cause());
        }
    }
}

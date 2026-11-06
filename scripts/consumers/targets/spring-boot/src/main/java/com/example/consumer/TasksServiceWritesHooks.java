package com.example.consumer;

import com.example.tasksservicewrites.api.ServiceAuthenticateHook;
import com.example.tasksservicewrites.api.ServiceAuthenticateRequest;
import com.example.tasksservicewrites.api.TasksServiceWritesDecider;
import com.example.tasksservicewrites.api.TasksServiceWritesUnexpectedErrorListener;
import com.example.tasksservicewrites.api.schemas.CallerServiceParams;
import com.example.tasksservicewrites.api.schemas.Service;
import com.example.tasksservicewrites.api.schemas.ServicePrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import io.github.jubasse.seampact.springboot.runtime.RequirementCall;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The `tasksServiceWrites` api's hook doubles, the `tasksService` ones on its own generated types. */
final class TasksServiceWritesHooks {
    private static final String API = "tasksServiceWrites";
    private static final String CALLER_SERVICE_RIGHT = "callerService";

    private TasksServiceWritesHooks() {}

    /** The `service` identity: one of the fixed service JWTs, accepted as is. */
    @Component
    static final class ServiceWritesHook implements ServiceAuthenticateHook {
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
    static final class ServiceWritesDecider implements TasksServiceWritesDecider {
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

            return request.params().filter(CallerServiceParams.class::isInstance).map(CallerServiceParams.class::cast)
                    .map(params -> params.allowed().contains(principal.service())).orElse(false);
        }
    }

    @Component
    static final class TasksServiceWritesUnexpectedErrors implements TasksServiceWritesUnexpectedErrorListener {
        @Override
        public void onUnexpectedError(UnexpectedFailure failure) {
            UnexpectedFailures.log(failure.api(), failure.operation(), failure.reason(), failure.cause());
        }
    }
}

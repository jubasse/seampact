package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.optins.api.PeekTaskInput;
import com.example.optins.api.PeekTaskResult;
import com.example.optins.api.ServiceAuthenticateHook;
import com.example.optins.api.spring.PeekTask;
import com.example.tasks.api.GetTaskInput;
import com.example.tasks.api.GetTaskResult;
import com.example.tasks.api.TasksScopeResolver;
import com.example.tasks.api.UserAuthenticateHook;
import com.example.tasks.api.schemas.UserPrincipal;
import com.example.tasks.api.spring.GetTask;
import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import com.example.tasksservice.api.schemas.Service;
import com.example.tasksservice.api.schemas.ServicePrincipal;
import com.example.tasksservice.api.spring.TasksServiceContractTable;
import com.example.tasksservice.api.spring.TasksServiceSeampactBinding;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.ScopeIdSource;
import io.github.jubasse.seampact.hooks.ScopeResolution;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.MethodParameter;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.method.HandlerMethod;

/**
 * What a handler reads of its caller (ADR 0012 "Open tenancy"): the input its method receives carries the principal
 * the authenticate hook answered and the scopes the resolvers answered, null for an anonymous caller on an
 * optional-auth route, and each api's input carries its own api's principal.
 */
class HandlerAccessTest {
    private static final UUID CHANNEL_ID = UUID.fromString("0b8f3a52-6f0e-4c39-9a51-0d7b7c1d2e3f");
    private static final UUID TASK_ID = UUID.fromString("5d3c1f2e-8a4b-4c6d-9e0f-1a2b3c4d5e6f");
    private static final UUID USER_ID = UUID.fromString("7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928");
    private static final String CHANNEL_APP_VALUE = "the channel the resolver loaded";
    private static final String ACCEPTED_TOKEN = "accepted";
    private static final String REFUSED_TOKEN = "refused";

    private final StaticListableBeanFactory beans = new StaticListableBeanFactory();
    private final List<UnexpectedErrorListener.UnexpectedFailure> failures = new ArrayList<>();

    HandlerAccessTest() {
        UserAuthenticateHook userHook = request -> new AuthenticateResult.Authenticated<>(new UserPrincipal(USER_ID));
        TasksScopeResolver channelResolver = new TasksScopeResolver() {
            @Override
            public String scope() {
                return "channel";
            }

            @Override
            public ScopeResolution<ResolvedScope<?, ?>, Denial> resolveScope(ScopeCall call) {
                Object id = ((ScopeIdSource.Declared<Object>) call.source()).id();
                return new ScopeResolution.Resolved<>(new ResolvedScope<>(call.scope(), id, Optional.of(CHANNEL_APP_VALUE)));
            }
        };
        com.example.tasksservice.api.ServiceAuthenticateHook serviceHook = request ->
                new AuthenticateResult.Authenticated<>(new ServicePrincipal(Service.CATALOG, USER_ID));
        com.example.tasksservice.api.TasksServiceDecider serviceDecider = new com.example.tasksservice.api.TasksServiceDecider() {
            @Override
            public Set<String> names() {
                return Set.of(EVERY_NAME);
            }

            @Override
            public Decision<Denial> decide(RequirementCall call) {
                return new Decision.Allowed<>();
            }
        };
        ServiceAuthenticateHook optInsHook = request -> request.credentials().internalToken().orElseThrow().equals(ACCEPTED_TOKEN)
                ? new AuthenticateResult.Authenticated<>(new com.example.optins.api.schemas.ServicePrincipal(com.example.optins.api.schemas.Service.CATALOG, USER_ID))
                : new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated"));
        com.example.optins.api.TasksServiceDecider optInsDecider = new com.example.optins.api.TasksServiceDecider() {
            @Override
            public Set<String> names() {
                return Set.of(EVERY_NAME);
            }

            @Override
            public Decision<Denial> decide(RequirementCall call) {
                return new Decision.Allowed<>();
            }
        };

        com.example.tasks.api.TasksUnexpectedErrorListener tasksFailures = failures::add;
        com.example.tasksservice.api.TasksServiceUnexpectedErrorListener serviceFailures = failures::add;
        com.example.optins.api.TasksServiceUnexpectedErrorListener optInsFailures = failures::add;
        beans.addBean("tasksFailures", tasksFailures);
        beans.addBean("serviceFailures", serviceFailures);
        beans.addBean("optInsFailures", optInsFailures);
        beans.addBean("userHook", userHook);
        beans.addBean("channelResolver", channelResolver);
        beans.addBean("serviceHook", serviceHook);
        beans.addBean("serviceDecider", serviceDecider);
        beans.addBean("optInsHook", optInsHook);
        beans.addBean("optInsDecider", optInsDecider);
    }

    @Test
    void theHandlerReadsItsPrincipalAndItsScopes() throws Exception {
        SeampactBoundary boundary = new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), beans, new StandardEnvironment());
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v1/channels/" + CHANNEL_ID + "/tasks/" + TASK_ID);
        request.addHeader("Authorization", "Bearer " + ACCEPTED_TOKEN);

        GetTaskInput input = (GetTaskInput) inputOf(boundary, request, TasksHandlers.class.getMethod("getTask", GetTaskInput.class));

        assertEquals(new UserPrincipal(USER_ID), input.principal());
        assertEquals(new ResolvedScope<>("channel", CHANNEL_ID, Optional.of(CHANNEL_APP_VALUE)), input.scopes().channel());
    }

    @Test
    void anAnonymousCallerOnAnOptionalRouteHasANullPrincipal() throws Exception {
        SeampactBoundary boundary = new SeampactBoundary(com.example.optins.api.spring.TasksServiceContractTable.json(),
                new com.example.optins.api.spring.TasksServiceSeampactBinding(), beans, new StandardEnvironment());
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/internal/v1/channels/" + CHANNEL_ID + "/peeks/" + TASK_ID);
        request.addHeader("Authorization", "Bearer " + REFUSED_TOKEN);
        request.addHeader("X-Deadline", "2026-10-28T12:00:00Z");

        PeekTaskInput input = (PeekTaskInput) inputOf(boundary, request, OptInsHandlers.class.getMethod("peekTask", PeekTaskInput.class));

        assertNull(input.principal());
    }

    @Test
    void eachApisInputCarriesItsOwnApisPrincipal() throws Exception {
        SeampactBoundary tasks = new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), beans, new StandardEnvironment());
        SeampactBoundary tasksService = new SeampactBoundary(TasksServiceContractTable.json(), new TasksServiceSeampactBinding(), beans, new StandardEnvironment());
        MockHttpServletRequest tasksRequest = new MockHttpServletRequest("GET", "/v1/channels/" + CHANNEL_ID + "/tasks/" + TASK_ID);
        tasksRequest.addHeader("Authorization", "Bearer " + ACCEPTED_TOKEN);
        MockHttpServletRequest serviceRequest = new MockHttpServletRequest("GET", "/internal/v1/channels/" + CHANNEL_ID + "/tasks/" + TASK_ID);
        serviceRequest.addHeader("Authorization", "Bearer " + ACCEPTED_TOKEN);
        serviceRequest.addHeader("X-Deadline", "2026-10-28T12:00:00Z");

        GetTaskInput tasksInput = (GetTaskInput) inputOf(tasks, tasksRequest, TasksHandlers.class.getMethod("getTask", GetTaskInput.class));
        com.example.tasksservice.api.GetTaskInput serviceInput = (com.example.tasksservice.api.GetTaskInput) inputOf(tasksService, serviceRequest,
                TasksServiceHandlers.class.getMethod("getTask", com.example.tasksservice.api.GetTaskInput.class));

        assertEquals(new UserPrincipal(USER_ID), tasksInput.principal());
        assertEquals(new ServicePrincipal(Service.CATALOG, USER_ID), serviceInput.principal());
    }

    // The request through the boundary filter, the interceptor and the input resolver, as Spring MVC runs them.
    private Object inputOf(SeampactBoundary boundary, MockHttpServletRequest request, Method handler) throws Exception {
        List<Object> inputs = new ArrayList<>();
        MockHttpServletResponse response = new MockHttpServletResponse();
        Object controller = handler.getDeclaringClass().getDeclaredConstructor().newInstance();

        new BoundaryFilter(boundary).doFilter(request, response, (filtered, reply) -> {
            HttpServletRequest seen = (HttpServletRequest) filtered;
            if (!new BoundaryInterceptor(boundary).preHandle(seen, (HttpServletResponse) reply, new HandlerMethod(controller, handler))) return;
            inputs.add(new ContractInputResolver(boundary).resolveArgument(new MethodParameter(handler, 0), null, new ServletWebRequest(seen), null));
        });

        assertTrue(inputs.size() == 1, "the handler was not reached: " + response.getStatus() + " " + failures);
        return inputs.get(0);
    }

    /** The controllers of the three apis, one contract method each. */
    public static final class TasksHandlers {
        @GetTask
        public GetTaskResult getTask(GetTaskInput input) {
            throw new UnsupportedOperationException();
        }
    }

    public static final class TasksServiceHandlers {
        @com.example.tasksservice.api.spring.GetTask
        public com.example.tasksservice.api.GetTaskResult getTask(com.example.tasksservice.api.GetTaskInput input) {
            throw new UnsupportedOperationException();
        }
    }

    public static final class OptInsHandlers {
        @PeekTask
        public PeekTaskResult peekTask(PeekTaskInput input) {
            throw new UnsupportedOperationException();
        }
    }
}

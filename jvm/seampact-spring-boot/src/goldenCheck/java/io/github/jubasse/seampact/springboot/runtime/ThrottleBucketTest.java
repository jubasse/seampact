package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.tasks.api.CreateTaskInput;
import com.example.tasks.api.CreateTaskResult;
import com.example.tasks.api.TasksDecider;
import com.example.tasks.api.TasksScopeResolver;
import com.example.tasks.api.UserAuthenticateHook;
import com.example.tasks.api.schemas.UserPrincipal;
import com.example.tasks.api.spring.CreateTask;
import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.ScopeIdSource;
import io.github.jubasse.seampact.hooks.ScopeResolution;
import io.github.jubasse.seampact.hooks.ThrottleBucket;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

/**
 * The bucket a throttle rule's decide call receives on the golden reference api (CHK-015): the declared bucket's id,
 * the values of its key sources read from the request, and its limit and window.
 */
class ThrottleBucketTest {
    private static final UUID CHANNEL_ID = UUID.fromString("0b8f3a52-6f0e-4c39-9a51-0d7b7c1d2e3f");
    private static final UUID USER_ID = UUID.fromString("7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928");
    private static final String THROTTLE_RULE = "throttle";
    private static final String WRITE_BUCKET = "write";
    private static final long WRITE_LIMIT = 60;
    private static final long WRITE_WINDOW_MS = 60_000;

    private final StaticListableBeanFactory beans = new StaticListableBeanFactory();
    private final List<RequirementCall> decideCalls = new ArrayList<>();

    ThrottleBucketTest() {
        UserAuthenticateHook userHook = request -> new AuthenticateResult.Authenticated<>(new UserPrincipal(USER_ID));
        TasksScopeResolver channelResolver = new TasksScopeResolver() {
            @Override
            public String scope() {
                return "channel";
            }

            @Override
            public ScopeResolution<ResolvedScope<?, ?>, Denial> resolveScope(ScopeCall call) {
                Object id = ((ScopeIdSource.Declared<Object>) call.source()).id();
                return new ScopeResolution.Resolved<>(new ResolvedScope<>(call.scope(), id, Optional.empty()));
            }
        };
        TasksDecider decider = new TasksDecider() {
            @Override
            public Set<String> names() {
                return Set.of(EVERY_NAME);
            }

            @Override
            public Decision<Denial> decide(RequirementCall call) {
                decideCalls.add(call);
                return new Decision.Allowed<>();
            }
        };

        beans.addBean("userHook", userHook);
        beans.addBean("channelResolver", channelResolver);
        beans.addBean("decider", decider);
    }

    @Test
    void theThrottleDecideCallReceivesTheBucketKeyValuesLimitAndWindow() throws Exception {
        SeampactBoundary boundary = new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), beans, new StandardEnvironment());
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v1/channels/" + CHANNEL_ID + "/tasks");
        request.addHeader("Authorization", "Bearer accepted");
        request.addHeader("Idempotency-Key", UUID.randomUUID().toString());
        request.setContentType("application/json");
        request.setContent("{\"title\":\"Counted\"}".getBytes(StandardCharsets.UTF_8));

        throughTheInterceptor(boundary, request);

        ThrottleBucket bucket = decideCalls.stream().filter(call -> call.name().equals(THROTTLE_RULE)).findFirst().orElseThrow().bucket().orElseThrow();
        assertEquals(WRITE_BUCKET, bucket.id());
        assertEquals(List.of(USER_ID.toString()), bucket.values().stream().map(String::valueOf).toList());
        assertEquals(Optional.of(WRITE_LIMIT), bucket.limit());
        assertEquals(Optional.of(WRITE_WINDOW_MS), bucket.windowMs());
    }

    // The request through the boundary filter and the interceptor, where the access steps call the decide hook.
    private void throughTheInterceptor(SeampactBoundary boundary, MockHttpServletRequest request) throws Exception {
        TasksHandlers controller = new TasksHandlers();
        HandlerMethod handler = new HandlerMethod(controller, TasksHandlers.class.getMethod("createTask", CreateTaskInput.class));

        new BoundaryFilter(boundary).doFilter(request, new MockHttpServletResponse(),
                (filtered, reply) -> new BoundaryInterceptor(boundary).preHandle((HttpServletRequest) filtered, (HttpServletResponse) reply, handler));
    }

    public static final class TasksHandlers {
        @CreateTask
        public CreateTaskResult createTask(CreateTaskInput input) {
            throw new UnsupportedOperationException();
        }
    }
}

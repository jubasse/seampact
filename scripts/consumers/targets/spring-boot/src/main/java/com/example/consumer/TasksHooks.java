package com.example.consumer;

import com.example.tasks.api.UserAuthenticateHook;
import com.example.tasks.api.UserAuthenticateRequest;
import com.example.tasks.api.schemas.UserPrincipal;
import com.example.tasks.api.spring.runtime.Decider;
import com.example.tasks.api.spring.runtime.Denial;
import com.example.tasks.api.spring.runtime.RequirementCall;
import com.example.tasks.api.spring.runtime.ScopeCall;
import com.example.tasks.api.spring.runtime.ScopeResolver;
import com.example.tasks.api.spring.runtime.UnexpectedErrorListener;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.ScopeIdSource;
import io.github.jubasse.seampact.hooks.ScopeResolution;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The `tasks` api's hook doubles: they record each call and answer what the loaded script says. */
final class TasksHooks {
    private static final String API = "tasks";

    private TasksHooks() {}

    /** The `user` identity: a bearer token of the credentials, or the same token as the session cookie. */
    @Component
    @SkippedUnder("missing-authenticate-hook")
    static final class UserHook implements UserAuthenticateHook {
        private static final Map<String, String> USER_IDS = Map.of(
                Credentials.text("userToken"), Credentials.text("userId"),
                Credentials.text("throttledUserToken"), Credentials.text("throttledUserId"));

        @Override
        public AuthenticateResult<UserPrincipal, Denial> authenticate(UserAuthenticateRequest request) {
            SuiteControl.recordHookCall("authenticate:user", API, request.operation().id());

            String token = request.credentials().bearer().or(() -> request.credentials().sessionCookie()).orElse("");
            String userId = USER_IDS.get(token);

            return userId == null
                    ? new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated"))
                    : new AuthenticateResult.Authenticated<>(new UserPrincipal(UUID.fromString(userId)));
        }
    }

    /** Denies what the script denies; allows every other right and rule. */
    @Component
    @SkippedUnder("missing-decider")
    static final class TasksDecider implements Decider {
        @Override
        public Set<String> names() {
            return Set.of(EVERY_NAME);
        }

        @Override
        public Decision<Denial> decide(RequirementCall request) {
            SuiteControl.recordHookCall("decide:" + request.name(), API, request.operation().id());

            Optional<String> denied = SuiteControl.scriptedDecision(request.name(), Purposes.nameOf(request.purpose()));

            return denied.<Decision<Denial>>map(code -> new Decision.Denied<>(Denial.of(code))).orElseGet(Decision.Allowed::new);
        }
    }

    /** Resolves a declared channel id to itself, every channel existing, unless the script denies the scope. */
    @Component
    @SkippedUnder("missing-scope-resolver")
    static final class ChannelResolver implements ScopeResolver {
        @Override
        public String scope() {
            return "channel";
        }

        @Override
        public ScopeResolution<ResolvedScope<?, ?>, Denial> resolveScope(ScopeCall request) {
            if (!(request.source() instanceof ScopeIdSource.Declared<Object> declared)) {
                throw new IllegalStateException("the consumer resolves declared scope ids only, not '" + request.scope() + "'");
            }

            Optional<String> denied = SuiteControl.scriptedScopeDenial(request.scope());
            if (denied.isPresent()) return new ScopeResolution.Denied<>(Denial.of(denied.get()));

            return new ScopeResolution.Resolved<>(new ResolvedScope<>(request.scope(), declared.id(), Optional.empty()));
        }
    }

    /** Writes each unexpected failure to the log, which the log-lines route captures. */
    @Component
    static final class TasksUnexpectedErrors implements UnexpectedErrorListener {
        @Override
        public void onUnexpectedError(UnexpectedFailure failure) {
            UnexpectedFailures.log(failure.api(), failure.operation(), failure.reason(), failure.cause());
        }
    }
}

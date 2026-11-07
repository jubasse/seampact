package com.example.consumer;

import com.example.tasksresponses.api.TasksResponsesUnexpectedErrorListener;
import com.example.tasksresponses.api.UserAuthenticateHook;
import com.example.tasksresponses.api.UserAuthenticateRequest;
import com.example.tasksresponses.api.schemas.UserPrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** The `tasksResponses` api's hook doubles. */
final class TasksResponsesHooks {
    private static final String API = "tasksResponses";

    private TasksResponsesHooks() {}

    /** The `user` identity: the credentials' user token as a bearer or the session cookie. */
    @Component
    static final class UserHook implements UserAuthenticateHook {
        @Override
        public AuthenticateResult<UserPrincipal, Denial> authenticate(UserAuthenticateRequest request) {
            SuiteControl.recordHookCall("authenticate:user", API, request.operation().id());
            SuiteControl.throwScriptedHookFailure("authenticate:user");

            String token = request.credentials().bearer().or(() -> request.credentials().sessionCookie()).orElse("");

            return token.equals(Credentials.text("userToken"))
                    ? new AuthenticateResult.Authenticated<>(new UserPrincipal(UUID.fromString(Credentials.text("userId"))))
                    : new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated"));
        }
    }

    @Component
    static final class TasksResponsesUnexpectedErrors implements TasksResponsesUnexpectedErrorListener {
        @Override
        public void onUnexpectedError(UnexpectedFailure failure) {
            UnexpectedFailures.log(failure.api(), failure.operation(), failure.reason(), failure.cause());
        }
    }
}

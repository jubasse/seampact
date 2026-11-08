package com.example.consumer;

import com.example.tasksoptionalauth.api.TasksOptionalAuthUnexpectedErrorListener;
import com.example.tasksoptionalauth.api.UserAuthenticateHook;
import com.example.tasksoptionalauth.api.UserAuthenticateRequest;
import com.example.tasksoptionalauth.api.schemas.UserPrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import org.springframework.stereotype.Component;

/** The `tasksOptionalAuth` api's hook doubles. */
final class TasksOptionalAuthHooks {
    private static final String API = "tasksOptionalAuth";

    private TasksOptionalAuthHooks() {}

    /** The `user` identity, as the `tasks` api's double reads it. */
    @Component
    static final class UserHook implements UserAuthenticateHook {
        @Override
        public AuthenticateResult<UserPrincipal, Denial> authenticate(UserAuthenticateRequest request) {
            SuiteControl.recordHookCall("authenticate:user", API, request.operation().id());
            SuiteControl.throwScriptedHookFailure("authenticate:user");

            return UserTokens.userIdOf(request.credentials().bearer(), request.credentials().sessionCookie())
                    .<AuthenticateResult<UserPrincipal, Denial>>map(userId -> new AuthenticateResult.Authenticated<>(new UserPrincipal(userId)))
                    .orElseGet(() -> new AuthenticateResult.Denied<>(Denial.of("api.unauthenticated")));
        }
    }

    @Component
    static final class TasksOptionalAuthUnexpectedErrors implements TasksOptionalAuthUnexpectedErrorListener {
        @Override
        public void onUnexpectedError(UnexpectedFailure failure) {
            UnexpectedFailures.log(failure.api(), failure.operation(), failure.reason(), failure.cause());
        }
    }
}

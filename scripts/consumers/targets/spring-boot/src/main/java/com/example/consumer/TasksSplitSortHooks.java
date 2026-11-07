package com.example.consumer;

import com.example.taskssplitsort.api.TasksSplitSortUnexpectedErrorListener;
import com.example.taskssplitsort.api.UserAuthenticateHook;
import com.example.taskssplitsort.api.UserAuthenticateRequest;
import com.example.taskssplitsort.api.schemas.UserPrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import org.springframework.stereotype.Component;

/** The `tasksSplitSort` api's hook doubles. */
final class TasksSplitSortHooks {
    private static final String API = "tasksSplitSort";

    private TasksSplitSortHooks() {}

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
    static final class TasksSplitSortUnexpectedErrors implements TasksSplitSortUnexpectedErrorListener {
        @Override
        public void onUnexpectedError(UnexpectedFailure failure) {
            UnexpectedFailures.log(failure.api(), failure.operation(), failure.reason(), failure.cause());
        }
    }
}

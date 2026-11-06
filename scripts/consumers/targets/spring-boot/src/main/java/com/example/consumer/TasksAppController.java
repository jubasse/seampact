package com.example.consumer;

import com.example.tasks.api.AppEndpoints;
import com.example.tasks.api.HealthInput;
import com.example.tasks.api.HealthResult;
import com.example.tasks.api.schemas.Health;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.web.bind.annotation.RestController;

/**
 * The `tasks` api's `health` controller, in a file of its own: the app built with `health` filtered out leaves this
 * source out, since its generated code has no `AppEndpoints`.
 */
@RestController
@SkippedUnder("missing-handler")
final class TasksAppController implements AppEndpoints {
    private static final String API = "tasks";

    private final ScriptedAnswers answers;

    TasksAppController(ScriptedAnswers answers) {
        this.answers = answers;
    }

    @Override
    @com.example.tasks.api.spring.Health
    public HealthResult health(HealthInput input) {
        return answers.answer(API, "health", 200, Health.class, HealthResult.Status200::new, Map.<String, Supplier<HealthResult>>of())
                .orElseGet(() -> new HealthResult.Status200(new Health("ok")));
    }
}

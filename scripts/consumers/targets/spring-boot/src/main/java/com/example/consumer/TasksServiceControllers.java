package com.example.consumer;

import com.example.tasksservice.api.ApiDeadlineExceededError;
import com.example.tasksservice.api.GetTaskInput;
import com.example.tasksservice.api.GetTaskResult;
import com.example.tasksservice.api.InternalEndpoints;
import com.example.tasksservice.api.schemas.Task;
import com.example.tasksservice.api.spring.GetTask;
import java.time.OffsetDateTime;
import java.util.Map;
import org.springframework.web.bind.annotation.RestController;

/** The `tasksService` api's controller; stopping the work once the deadline has passed is the handler's part. */
@RestController
final class TasksServiceControllers implements InternalEndpoints {
    private final ScriptedAnswers answers;

    TasksServiceControllers(ScriptedAnswers answers) {
        this.answers = answers;
    }

    @Override
    @GetTask
    public GetTaskResult getTask(GetTaskInput input) throws ApiDeadlineExceededError {
        if (!OffsetDateTime.parse(input.headers().xDeadline()).isAfter(OffsetDateTime.now())) throw new ApiDeadlineExceededError();

        return answers.answer("tasksService", "getTask", 200, Task.class, GetTaskResult.Status200::new, Map.<String, java.util.function.Supplier<GetTaskResult>>of())
                .orElseGet(() -> new GetTaskResult.Status200(SampleData.serviceTask(input.path().taskId())));
    }
}

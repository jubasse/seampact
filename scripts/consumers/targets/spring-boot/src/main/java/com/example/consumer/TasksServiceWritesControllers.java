package com.example.consumer;

import com.example.tasksservicewrites.api.CreateTaskInput;
import com.example.tasksservicewrites.api.CreateTaskResult;
import com.example.tasksservicewrites.api.InternalWritesEndpoints;
import com.example.tasksservicewrites.api.schemas.Task;
import com.example.tasksservicewrites.api.schemas.TaskState;
import com.example.tasksservicewrites.api.spring.CreateTask;
import java.util.Optional;
import java.util.UUID;
import org.springframework.web.bind.annotation.RestController;

/** The `tasksServiceWrites` api's controller: the relayed write creates the task it is given. */
@RestController
final class TasksServiceWritesControllers implements InternalWritesEndpoints {
    @Override
    @CreateTask
    public CreateTaskResult createTask(CreateTaskInput input) {
        return new CreateTaskResult.Status201(new Task(UUID.randomUUID(), input.body().title(), TaskState.OPEN, Optional.empty(),
                SampleData.FIRST_VERSION, SampleData.CREATED_AT));
    }
}

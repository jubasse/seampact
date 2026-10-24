package com.example.consumer;

import com.example.tasks.api.schemas.Task;
import com.example.tasks.api.schemas.TaskState;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/** The values the handlers answer without a script. */
final class SampleData {
    static final OffsetDateTime CREATED_AT = OffsetDateTime.parse("2026-10-18T09:00:00.000Z");
    static final UUID NEW_TASK_ID = UUID.fromString("20000000-0000-4000-8000-0000000000ff");
    static final long FIRST_VERSION = 1;

    private SampleData() {}

    static Task task(UUID taskId) {
        return new Task(taskId, "Write the slice test", TaskState.OPEN, Optional.empty(), FIRST_VERSION, CREATED_AT);
    }

    static com.example.tasksservice.api.schemas.Task serviceTask(UUID taskId) {
        return new com.example.tasksservice.api.schemas.Task(taskId, "Write the slice test",
                com.example.tasksservice.api.schemas.TaskState.OPEN, Optional.empty(), FIRST_VERSION, CREATED_AT);
    }
}

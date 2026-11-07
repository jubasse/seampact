package com.example.consumer;

import com.example.tasks.api.schemas.Channel;
import com.example.tasks.api.schemas.Task;
import com.example.tasks.api.schemas.TaskState;
import com.example.tasksabsoluteurls.api.schemas.Note;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** The values the handlers answer without a script. */
final class SampleData {
    static final OffsetDateTime CREATED_AT = OffsetDateTime.parse("2026-10-18T09:00:00.000Z");
    static final UUID NEW_TASK_ID = UUID.fromString("20000000-0000-4000-8000-0000000000ff");
    static final long FIRST_VERSION = 1;
    static final UUID GENERAL_CHANNEL_ID = UUID.fromString("10000000-0000-4000-8000-000000000001");
    static final UUID FIRST_NOTE_ID = UUID.fromString("40000000-0000-4000-8000-000000000001");

    // The sample task a state filter on listTasks answers for each state it lists, in the order it lists them.
    private static final Map<TaskState, UUID> SAMPLE_TASK_ID_BY_STATE = Map.of(
            TaskState.OPEN, NEW_TASK_ID,
            TaskState.DONE, UUID.fromString("20000000-0000-4000-8000-0000000000fe"),
            TaskState.ARCHIVED, UUID.fromString("20000000-0000-4000-8000-0000000000fd"));

    private SampleData() {}

    static Task task(UUID taskId) {
        return new Task(taskId, "Write the slice test", TaskState.OPEN, Optional.empty(), FIRST_VERSION, CREATED_AT);
    }

    /** The tasks listTasks answers: the one new task with no state filter, else one sample task per listed state. */
    static List<Task> listedTasks(Optional<List<TaskState>> states) {
        return states.map(listed -> listed.stream().map(SampleData::taskInState).toList()).orElseGet(() -> List.of(task(NEW_TASK_ID)));
    }

    static Task taskInState(TaskState state) {
        return new Task(SAMPLE_TASK_ID_BY_STATE.get(state), "Write the slice test", state, Optional.empty(), FIRST_VERSION, CREATED_AT);
    }

    static Channel generalChannel() {
        return new Channel(GENERAL_CHANNEL_ID, "General");
    }

    static Note note(UUID noteId) {
        return new Note(noteId, "Read the slice notes");
    }

    static com.example.tasksservice.api.schemas.Task serviceTask(UUID taskId) {
        return new com.example.tasksservice.api.schemas.Task(taskId, "Write the slice test",
                com.example.tasksservice.api.schemas.TaskState.OPEN, Optional.empty(), FIRST_VERSION, CREATED_AT);
    }
}

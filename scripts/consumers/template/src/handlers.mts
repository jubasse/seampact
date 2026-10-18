// The handlers every Node server consumer's controllers delegate to, framework-neutral and typed by the generated
// operation types: one declared success per operation, as the slice test expects.
import type * as Tasks from "../generated/types/tasks/index.js";
import type * as TasksService from "../generated/types/tasksService/index.js";

const CREATED_AT = "2026-10-18T09:00:00.000Z";
const NEW_TASK_ID = "20000000-0000-4000-8000-0000000000ff";
const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";
const FIRST_VERSION = 1;

function task(taskId: string, title = "Write the slice test"): Tasks.schemas.Task {
  return { taskId, title, state: "open", version: FIRST_VERSION, createdAt: CREATED_AT };
}

function updated(task: Tasks.schemas.Task): Tasks.schemas.Task {
  return { ...task, version: task.version + 1 };
}

/** The `tasks` api's handlers, by operation. */
export const tasksHandlers = {
  health(): Tasks.HealthOutput {
    return { status: 200, body: { status: "ok" } };
  },

  listChannels(_input: Tasks.ListChannelsInput): Tasks.ListChannelsOutput {
    return { status: 200, body: { items: [{ channelId: GENERAL_CHANNEL_ID, name: "General" }] } };
  },

  getChannel(input: Tasks.GetChannelInput): Tasks.GetChannelOutput {
    return { status: 200, body: { channelId: input.path.channelId, name: "General" } };
  },

  listTasks(input: Tasks.ListTasksInput): Tasks.ListTasksOutput {
    const items = [task(NEW_TASK_ID)];

    return {
      status: 200,
      body: input.query.cursor === undefined ? { items, nextCursor: "page-2" } : { items },
    };
  },

  createTask(input: Tasks.CreateTaskInput): Tasks.CreateTaskOutput {
    return { status: 201, body: task(NEW_TASK_ID, input.body.title) };
  },

  getTasksBatch(input: Tasks.GetTasksBatchInput): Tasks.GetTasksBatchOutput {
    return { status: 200, body: input.body.ids.map((taskId) => task(taskId)) };
  },

  searchTasks(_input: Tasks.SearchTasksInput): Tasks.SearchTasksOutput {
    return { status: 200, body: { items: [task(NEW_TASK_ID)], total: 1 } };
  },

  getTask(input: Tasks.GetTaskInput): Tasks.GetTaskOutput {
    return { status: 200, body: task(input.path.taskId) };
  },

  updateTask(input: Tasks.UpdateTaskInput): Tasks.UpdateTaskOutput {
    const title = input.body.title ?? task(input.path.taskId).title;

    return { status: 200, body: updated(task(input.path.taskId, title)) };
  },

  archiveTask(input: Tasks.ArchiveTaskInput): Tasks.ArchiveTaskOutput {
    return { status: 200, body: { ...updated(task(input.path.taskId)), state: "archived" } };
  },

  assignTask(input: Tasks.AssignTaskInput): Tasks.AssignTaskOutput {
    return { status: 200, body: task(input.path.taskId) };
  },

  purgeTask(_input: Tasks.PurgeTaskInput): Tasks.PurgeTaskOutput {
    return { status: 204 };
  },

  getDraft(input: Tasks.GetDraftInput): Tasks.GetDraftOutput {
    return { status: 200, body: { draftId: input.path.draftId, body: "Draft text" } };
  },

  deleteDraft(input: Tasks.DeleteDraftInput): Tasks.DeleteDraftOutput {
    return { status: 200, body: { draftId: input.path.draftId, body: "Draft text" } };
  },

  getPreferences(_input: Tasks.GetPreferencesInput): Tasks.GetPreferencesOutput {
    return { status: 200, body: { locale: "en" } };
  },

  updatePreferences(input: Tasks.UpdatePreferencesInput): Tasks.UpdatePreferencesOutput {
    return { status: 200, body: { locale: "en", ...input.body } };
  },

  payments(_input: Tasks.PaymentsInput): Tasks.PaymentsOutput {
    return { status: 204 };
  },
};

/** The `tasksService` api's handlers, by operation. */
export const tasksServiceHandlers = {
  getTask(input: TasksService.GetTaskInput): TasksService.GetTaskOutput {
    return { status: 200, body: task(input.path.taskId) };
  },
};

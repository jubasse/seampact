// The handlers every Node server consumer's controllers delegate to, framework-neutral and typed by the generated
// operation types: one declared success per operation, as the http suite expects, unless the script a case loaded
// answers for the operation.
import type * as Tasks from "../generated/types/tasks/index.js";
import type * as TasksService from "../generated/types/tasksService/index.js";
import { scriptedAnswer } from "./suite-control.mjs";

const CREATED_AT = "2026-10-18T09:00:00.000Z";
const NEW_TASK_ID = "20000000-0000-4000-8000-0000000000ff";
const NEXT_CURSOR = "page-2";
const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";
const FIRST_VERSION = 1;

function task(taskId: string, title = "Write the slice test"): Tasks.schemas.Task {
  return { taskId, title, state: "open", version: FIRST_VERSION, createdAt: CREATED_AT };
}

function updated(current: Tasks.schemas.Task): Tasks.schemas.Task {
  return { ...current, version: current.version + 1 };
}

// Every task is at its first version, so another expected version is stale.
const STALE_VERSION = { status: 409, code: "state.conflict" } as const;

// The boundary validates the deadline header; stopping the work once it has passed is the handler's part.
const DEADLINE_EXCEEDED = { status: 504, code: "api.deadline_exceeded" } as const;

/**
 * The handlers of one api, each answering what the loaded script gives its operation, as is, in place of its own
 * result: the script tests the boundary with results the handler types do not allow.
 */
function scripted<Handlers extends object>(api: string, handlers: Handlers): Handlers {
  return new Proxy(handlers, {
    get(target, property, receiver) {
      const handler: unknown = Reflect.get(target, property, receiver);

      if (typeof handler !== "function" || typeof property !== "string") return handler;

      return (...input: unknown[]) => {
        const answer = scriptedAnswer(api, property);

        if (answer === undefined) return Reflect.apply(handler, target, input);

        if ("throws" in answer) throw new Error(answer.throws);

        return answer;
      };
    },
  });
}

/** The `tasks` api's handlers, by operation. */
export const tasksHandlers = scripted("tasks", {
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
      body: input.query.cursor === undefined ? { items, nextCursor: NEXT_CURSOR } : { items },
    };
  },

  createTask(input: Tasks.CreateTaskInput): Tasks.CreateTaskOutput {
    return { status: 201, body: task(crypto.randomUUID(), input.body.title) };
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

  updateTask(input: Tasks.UpdateTaskInput): Tasks.UpdateTaskOutput | typeof STALE_VERSION {
    if (input.body.expectedVersion !== FIRST_VERSION) return STALE_VERSION;

    const title = input.body.title ?? task(input.path.taskId).title;

    return { status: 200, body: updated(task(input.path.taskId, title)) };
  },

  archiveTask(input: Tasks.ArchiveTaskInput): Tasks.ArchiveTaskOutput | typeof STALE_VERSION {
    if (input.body.expectedVersion !== FIRST_VERSION) return STALE_VERSION;

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
});

/** The `tasksService` api's handlers, by operation. */
export const tasksServiceHandlers = scripted("tasksService", {
  getTask(input: TasksService.GetTaskInput): TasksService.GetTaskOutput | typeof DEADLINE_EXCEEDED {
    if (Date.parse(input.headers["x-deadline"]) <= Date.now()) return DEADLINE_EXCEEDED;

    return { status: 200, body: task(input.path.taskId) };
  },
});

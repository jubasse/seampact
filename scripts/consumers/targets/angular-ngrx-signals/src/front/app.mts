// The angular-ngrx-signals consumer's app: its own Signal Store, which composes the generated `withListTasks` and
// `withCreateTask` features beside its own state, and a board that loads the channel's tasks and creates one. The
// features send through the `TasksApi` service, whose client sends through the app's `HttpClient`.
import { type HttpInterceptorFn, provideHttpClient, withInterceptors } from "@angular/common/http";
import { computed, type EnvironmentProviders, inject, type Provider } from "@angular/core";
import { signalStore, withComputed, withState } from "@ngrx/signals";
import {
  isContractError,
  provideTasksApi,
  type TasksOperations,
  withCreateTask,
  withListTasks,
} from "../../generated/queries/tasks/index.js";
import { jitComponent } from "./jit-component.mjs";

export const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";

// The declared error shown to the user, with the wait a throttled user is told, else the error's message.
function failureText(
  error: TasksOperations["createTask"]["error"] | undefined,
): string | undefined {
  if (error === undefined) return undefined;

  if (!isContractError(error) || error.failure.unexpected) return error.message;

  const { failure } = error;

  return failure.code === "api.rate_limited"
    ? `${failure.code} retry after ${failure.params.retryAfterMs} ms`
    : failure.code;
}

/** The app's own store: its state beside the generated slices, and what it reads from them. */
export const TaskBoardStore = signalStore(
  withState({ channelId: GENERAL_CHANNEL_ID }),
  withListTasks(),
  withCreateTask(),
  withComputed(({ listTasks, createTask }) => ({
    titles: computed(() => listTasks().data?.body.items.map((task) => task.title) ?? []),
    failure: computed(() => failureText(createTask().error)),
  })),
);

/** The token interceptor first, then `interceptors`, the tasks api and the app's store. */
export function appProviders(
  token: string,
  interceptors: readonly HttpInterceptorFn[] = [],
): (Provider | EnvironmentProviders)[] {
  const bearerToken: HttpInterceptorFn = (request, next) =>
    next(request.clone({ setHeaders: { authorization: `Bearer ${token}` } }));

  return [
    provideHttpClient(withInterceptors([bearerToken, ...interceptors])),
    provideTasksApi({ baseUrl: window.location.origin }),
    TaskBoardStore,
  ];
}

export class TaskBoard {
  readonly store = inject(TaskBoardStore);

  constructor() {
    void this.store.sendListTasks({ path: { channelId: this.store.channelId() } });
  }

  create(): void {
    void this.store.sendCreateTask({
      path: { channelId: this.store.channelId() },
      body: { title: "A new task" },
    });
  }
}

jitComponent(TaskBoard, {
  selector: "app-root",
  template: `
    <section>
      <ul aria-label="tasks">
        @for (title of store.titles(); track $index) {
          <li>{{ title }}</li>
        }
      </ul>
      <button type="button" (click)="create()">Create</button>
      @if (store.failure(); as failure) {
        <p role="alert">{{ failure }}</p>
      }
    </section>
  `,
});

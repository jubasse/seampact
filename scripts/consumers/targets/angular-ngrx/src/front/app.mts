// The angular-ngrx consumer's app: its own store, whose reducer keeps the channel's task titles and the last failure
// from the generated `TasksActions`, and a board that dispatches the list read and the create. The generated effects
// send them through the `TasksApi` service, whose client sends through the app's `HttpClient`.
import { type HttpInterceptorFn, provideHttpClient, withInterceptors } from "@angular/common/http";
import { type EnvironmentProviders, inject, type Provider } from "@angular/core";
import { createReducer, on, provideStore, Store } from "@ngrx/store";
import {
  isContractError,
  provideTasksApi,
  provideTasksEffects,
  TasksActions,
  type TasksOperations,
} from "../../generated/queries/tasks/index.js";
import { jitComponent } from "./jit-component.mjs";

export const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";

export interface TaskListState {
  readonly titles: readonly string[];
  readonly isLoading: boolean;
  readonly failure: string | undefined;
}

export interface AppState {
  readonly taskList: TaskListState;
}

const INITIAL_TASK_LIST: TaskListState = { titles: [], isLoading: false, failure: undefined };

// The declared error shown to the user, with the wait a throttled user is told, else the error's message.
function failureText(error: TasksOperations["createTask"]["error"]): string {
  if (!isContractError(error) || error.failure.unexpected) return error.message;

  const { failure } = error;

  return failure.code === "api.rate_limited"
    ? `${failure.code} retry after ${failure.params.retryAfterMs} ms`
    : failure.code;
}

/** The app's own reducer: the state shape is the app's, the events are the generated ones. */
export const taskListReducer = createReducer<TaskListState>(
  INITIAL_TASK_LIST,
  on(TasksActions.listTasks, (state) => ({ ...state, isLoading: true })),
  on(TasksActions.listTasksSuccess, (_state, { data }) => ({
    titles: data.body.items.map((task) => task.title),
    isLoading: false,
    failure: undefined,
  })),
  on(TasksActions.listTasksFailure, (state, { error }) => ({
    ...state,
    isLoading: false,
    failure: error.message,
  })),
  on(TasksActions.createTaskSuccess, (state, { data }) => ({
    ...state,
    titles: [...state.titles, data.body.title],
    failure: undefined,
  })),
  on(TasksActions.createTaskFailure, (state, { error }) => ({
    ...state,
    failure: failureText(error),
  })),
);

/** The token interceptor first, then `interceptors`, the app's store, the tasks api and its effects. */
export function appProviders(
  token: string,
  interceptors: readonly HttpInterceptorFn[] = [],
): (Provider | EnvironmentProviders)[] {
  const bearerToken: HttpInterceptorFn = (request, next) =>
    next(request.clone({ setHeaders: { authorization: `Bearer ${token}` } }));

  return [
    provideHttpClient(withInterceptors([bearerToken, ...interceptors])),
    provideStore({ taskList: taskListReducer }),
    provideTasksApi({ baseUrl: window.location.origin }),
    provideTasksEffects(),
  ];
}

export class TaskBoard {
  readonly store = inject<Store<AppState>>(Store);
  readonly taskList = this.store.selectSignal((state) => state.taskList);

  constructor() {
    this.store.dispatch(
      TasksActions.listTasks({ request: { path: { channelId: GENERAL_CHANNEL_ID } } }),
    );
  }

  create(): void {
    this.store.dispatch(
      TasksActions.createTask({
        request: { path: { channelId: GENERAL_CHANNEL_ID }, body: { title: "A new task" } },
      }),
    );
  }
}

jitComponent(TaskBoard, {
  selector: "app-root",
  template: `
    <section>
      <ul aria-label="tasks">
        @for (title of taskList().titles; track $index) {
          <li>{{ title }}</li>
        }
      </ul>
      <button type="button" (click)="create()">Create</button>
      @if (taskList().failure; as failure) {
        <p role="alert">{{ failure }}</p>
      }
    </section>
  `,
});

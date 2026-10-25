// The angular-fetch consumer's app: the channel's tasks through the generated `TasksApi` service, whose client sends
// through the app's `HttpClient`, with a "Refresh" button since nothing refreshes the list by itself, and a form that
// creates a task. The user's token is added by an app interceptor.
import { type HttpInterceptorFn, provideHttpClient, withInterceptors } from "@angular/common/http";
import { type EnvironmentProviders, inject, input, type Provider } from "@angular/core";
import { isContractError, provideTasksApi, TasksApi } from "../../generated/queries/tasks/index.js";
import { jitComponent } from "./jit-component.mjs";

export const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";

/** The interceptor that sends the user's token with every request. */
export function bearerToken(token: string): HttpInterceptorFn {
  return (request, next) =>
    next(request.clone({ setHeaders: { authorization: `Bearer ${token}` } }));
}

/** The app's providers: HttpClient with the token interceptor first, then `interceptors`, and the tasks api. */
export function appProviders(
  token: string,
  interceptors: readonly HttpInterceptorFn[] = [],
): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(withInterceptors([bearerToken(token), ...interceptors])),
    provideTasksApi({ baseUrl: window.location.origin }),
  ];
}

export class TaskList {
  readonly channelId = input(GENERAL_CHANNEL_ID);
  readonly tasks = inject(TasksApi).listTasks(() => ({ path: { channelId: this.channelId() } }));
}

jitComponent(
  TaskList,
  {
    selector: "app-task-list",
    template: `
      @if (tasks.error(); as error) {
        <p role="alert">{{ error.message }}</p>
      } @else if (tasks.data(); as data) {
        <section>
          <ul aria-label="tasks">
            @for (task of data.body.items; track task.taskId) {
              <li>{{ task.title }}</li>
            }
          </ul>
          <button type="button" [disabled]="tasks.isLoading()" (click)="tasks.refetch()">Refresh</button>
        </section>
      } @else {
        <p>Loading</p>
      }
    `,
  },
  ["channelId"],
);

export class CreateTask {
  readonly title = input("A new task");
  readonly create = inject(TasksApi).createTask();

  send(): void {
    void this.create.mutate({
      path: { channelId: GENERAL_CHANNEL_ID },
      body: { title: this.title() },
    });
  }

  // The declared error shown to the user, with the wait a throttled user is told.
  failureText(): string | undefined {
    const error = this.create.error();

    if (!isContractError(error) || error.failure.unexpected) return undefined;

    const { failure } = error;

    return failure.code === "api.rate_limited"
      ? `${failure.code} retry after ${failure.params.retryAfterMs} ms`
      : failure.code;
  }
}

jitComponent(
  CreateTask,
  {
    selector: "app-create-task",
    template: `
      <section>
        <button type="button" [disabled]="create.isPending()" (click)="send()">Create</button>
        @if (create.data(); as created) {
          <p>Created {{ created.body.title }}</p>
        }
        @if (failureText(); as text) {
          <p role="alert">{{ text }}</p>
        }
      </section>
    `,
  },
  ["title"],
);

export class TasksPage {}

jitComponent(TasksPage, {
  selector: "app-root",
  imports: [TaskList, CreateTask],
  template: `<app-task-list /><app-create-task title="A new task" />`,
});

# Write the handlers (NestJS)

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows; `Notes.Status` and `Notes.ErrorCode` name them. Create `src/notes-controller.ts`.

The generated server imports `@seampact/server-runtime`, which `install-into` put in `dependencies`; keep it at the version of your other seampact packages. Yarn Plug'n'Play is not supported: the check before generating looks for `@seampact/server-runtime` in `node_modules`.

```ts
import { randomUUID } from "node:crypto";
import { Controller } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

@Controller()
export class NotesController implements NotesNest.NotesEndpoints {
  @NotesNest.listNotes()
  listNotes(@NotesNest.listNotes.input() input: Notes.ListNotesInput) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  }

  @NotesNest.getNote()
  getNote(@NotesNest.getNote.input() input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  }

  @NotesNest.createNote()
  createNote(@NotesNest.createNote.input() input: Notes.CreateNoteInput) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  }

  @NotesNest.deleteNote()
  deleteNote(@NotesNest.deleteNote.input() input: Notes.DeleteNoteInput) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  }
}
```

`listNotes` returns every note; a real app reads `input.query.cursor` to page through them.

A service can also throw. `throw new NotFoundException()` answers the operation's 404 code, when it declares one. For any declared code, throw `new NotesNest.ContractException(code, params)`: it is typed with the api's codes and their params. A code with required params needs it: a plain `HttpException` of that status answers 500.

On a contract route, seampact's filter catches these exceptions before your global filters, so a global `@Catch(NotFoundException)` filter does not see them there.

Keep `@Controller()` without a path, and do not add `@HttpCode` or `@Header` to a contract method: the contract sets the paths, statuses and headers, and the app refuses to start otherwise.

Types come from `types/notes`. Decorators and handlers come from `server/notes`.

Create `src/app-module.ts`. A public api needs no hooks.

```ts
import { Module } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { NotesController } from "./notes-controller.js";

@Module({
  imports: [NotesNest.SeampactModule.forRoot()],
  controllers: [NotesController],
})
export class AppModule {}
```

Create `src/main.ts`. The body parser and the filter make bad JSON and unknown routes answer in the contract's error format.

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { AppModule } from "./app-module.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

app.useBodyParser("json", { limit: NotesNest.LARGEST_BODY_LIMIT, strict: false });
app.useGlobalFilters(NotesNest.preRoutingFilter);

await app.listen(3000);
```

Typecheck.

```sh
npx tsc -p .
```

You see no output.

A throttler's 429 works out of the box with `@nestjs/throttler`. When the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the throttler's `Retry-After` (seconds or an HTTP date), read from the reply or from the exception. Without a usable `Retry-After`, the reply is a logged 500 (with an optional `retryAfterMs`, the code is answered without it): throw `new NotesNest.ContractException(code, params)` instead.

## Who is calling

When an operation declares an identity, take its caller with `@<operation>.principal()`: what your authenticate hook returned, typed with the identity's principal schema. A public operation has no `principal()` decorator.

When an operation runs in a scope, `@<operation>.scopes()` gives one entry per scope, as your resolver returned it. An operation in no scope has no `scopes()` decorator.

```ts
@NotesNest.getNote()
getNote(
  @NotesNest.getNote.input() input: NotesNest.HandlerInputs["getNote"],
  @NotesNest.getNote.principal() principal: NotesNest.OperationAccess["getNote"]["principal"],
) {
  const ownerId = principal.userId;
```

The input typed with `HandlerInputs` carries the same `principal` and `scopes`, read-only. Spreading or serialising it leaves them out. The scope's `value` is `unknown`: narrow it before use.

## Behind a reverse proxy and in Docker

Trust only your proxy's addresses on the Express platform, so `req.ip` is the caller's:

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule);

app.set("trust proxy", ["loopback", "10.0.0.0/8"]);
```

The client address your hooks get is Express's `req.ip`, so it follows this setting.

The proxy forwards the contract's paths as they are (`/v1/notes`): strip only a prefix you added in front, such as `/api`. With `setGlobalPrefix`, exclude the contract routes: the app refuses to start when a contract route is under the prefix. The same goes for a `RouterModule` path on the controller's module. To serve the api under a prefix, set `mount: /api` on the target entry instead.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix. A client resolves them against the URL it called, not the API base URL.

Check your variables at boot with `ConfigModule.forRoot({ validate })`. Keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files.

## Wiring reference

Every server target takes four options: `bodyValidation` (check request bodies, off by default), `frameworkEtag` (`strip` by default removes an ETag the framework adds to a reply your code wrote outside the contract; `keep` leaves it), `catchAll` (`true` by default answers the api's 404 for a path under its base path that no route serves, or a method it does not serve; `false` leaves those requests to your app) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it.

The NestJS target also takes `reply`. With `handler` (the default), seampact writes the reply when your handler returns. With `interceptor`, your global interceptors (`app.useGlobalInterceptors(...)` or `APP_INTERCEPTOR`) map the result first, and seampact checks the mapped value against the contract.

Pass `{ logger }` as the second argument of `forRoot` to send seampact's warnings to your logger: `TasksNest.SeampactModule.forRoot(tasksHooks(), { logger })`. It needs `warn` and `error` functions.

When your hooks need providers, build them with `forRootAsync`. In a test, replace them with `overrideProvider(TasksNest.SEAMPACT_HOOKS).useValue(testHooks)`.

```ts
TasksNest.SeampactModule.forRootAsync({
  imports: [UsersModule],
  inject: [UsersService],
  useFactory: (users: UsersService) => tasksHooks(users),
});
```

Install `@nestjs/platform-express` (the Fastify platform is refused at boot), `reflect-metadata` and `rxjs`, and set `experimentalDecorators` in `tsconfig.json`. Import the generated module with your hooks, start the app with `rawBody: true` so signed routes see the bytes that were signed, and register `preRoutingFilter`. Without the filter, malformed JSON and unknown routes under the api's prefix answer with NestJS's own error body instead of the contract's format.

```ts
@Module({ imports: [TasksNest.SeampactModule.forRoot(tasksHooks())], controllers: [TasksController] })
export class AppModule {}

const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

app.useBodyParser("json", { limit: TasksNest.LARGEST_BODY_LIMIT, strict: false });
app.useGlobalFilters(TasksNest.preRoutingFilter);
```

For `@nestjs/swagger`, write the document with one call. It adds the contract schemas and stops the app if one of your classes replaces one. The setup is in [OpenAPI and docs](../configuration/openapi-and-docs.md).

```ts
const document = TasksNest.createContractDocument(app, config, { autoTagControllers: false });
```

Next: [run it](../getting-started/03-generate-and-run.md#run-it).

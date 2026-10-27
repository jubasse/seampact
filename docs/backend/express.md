# Write the handlers (Express)

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows; `Notes.Status` and `Notes.ErrorCode` name them. You need the Express target from [Generate](../getting-started/03-generate-and-run.md): `@seampact/codegen-express`.

Add Express to the app.

```sh
pnpm add express@5 && pnpm add -D @types/express@5
```

You see pnpm add both packages. The generated router imports `@seampact/server-runtime`, which [Install](../getting-started/01-install.md) already put in `dependencies`; keep it at the version of your other seampact packages. Yarn Plug'n'Play is not supported: the check before generating looks for `@seampact/server-runtime` in `node_modules`. The NestJS packages from [Install](../getting-started/01-install.md) stay unused; `pnpm remove @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs` drops them.

Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesExpress from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesHandlers: NotesExpress.NotesEndpoints = {
  listNotes(input) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  },

  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },

  createNote(input) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  },

  deleteNote(input) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  },
};
```

`listNotes` returns every note; a real app reads `input.query.cursor` to page through them.

Types come from `types/notes`. The handlers interface and the router come from `server/notes`.

Create `src/main.ts`. A public api needs no hooks. Mount the router at the root of the app, without a path: the contract paths already start with `/v1`.

```ts
import express from "express";
import * as NotesExpress from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";

const app = express();

app.use(NotesExpress.router({ handlers: { NotesEndpoints: notesHandlers } }));
app.use(NotesExpress.preRoutingErrorHandler);

app.listen(3000);
```

The router parses JSON itself, so bad JSON and unknown routes answer in the contract's error format. `preRoutingErrorHandler` does the same for errors raised by middleware you mount before the router, such as `express.json()` or a rate limiter. If you add such middleware, give a JSON parser `verify: NotesExpress.keepRawBody` and `limit: NotesExpress.LARGEST_BODY_LIMIT`.

Typecheck.

```sh
npx tsc -p .
```

You see no output.

A throttler's 429 works out of the box with `express-rate-limit`. When the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the throttler's `Retry-After` (seconds or an HTTP date), read from the reply or from the exception. Without a usable `Retry-After`, the reply is a logged 500 (with an optional `retryAfterMs`, the code is answered without it) that names the fix: answer the code from the handler with its params.

## Who is calling

When an operation declares an identity, its handler's `input` also has `principal`: what your authenticate hook returned, typed with the identity's principal schema. A public operation has no `principal`.

When an operation runs in a scope, `input.scopes` has one entry per scope, as your resolver returned it. An operation in no scope has no `scopes`.

Both are read-only and are not part of the request: spreading or serialising `input` leaves them out. Type the parameter with `HandlerInputs`.

```ts
getNote(input: NotesExpress.HandlerInputs["getNote"]) {
  const ownerId = input.principal.userId;
  const workspaceId = input.scopes.workspace.id;
```

The scope's `value` is `unknown`: narrow it before use.

## Test your routes

Build the app as `main.ts` does, without `listen`, and send requests with `supertest`. Send the credential header your authenticate hook reads.

```ts
const reply = await request(app).get(`/v1/notes/${noteId}`).set("authorization", "Bearer test-user");
```

To test a handler without HTTP, call it with a plain input. Add `principal` and `scopes` yourself: nothing checks them on a direct call.

```ts
const reply = await notesHandlers.getNote({ path: { noteId }, principal: { userId } });
```

To use test hooks, pass them to the router in the test app: `router({ handlers, hooks: testHooks })`.

With `NODE_ENV=development`, an exception your handler throws goes to Express's error handler, which shows its stack. seampact logs its message and the file and line it came from. Outside development, under the default `responses: strict`, the client gets the api's 500. Under `responses: warn` Express's reply goes out as written and the violation is logged, with its stack unless `NODE_ENV=production`.

## Behind a reverse proxy and in Docker

Trust only your proxy's addresses, never `true`, so `req.ip` and `req.protocol` are the caller's:

```ts
app.set("trust proxy", ["loopback", "10.0.0.0/8"]);
```

The client address your hooks get is `req.ip`, so it follows this setting.

The proxy forwards the contract's paths as they are (`/v1/notes`): strip only a prefix you added in front, such as `/api`. Mount the generated router at the app's root: mounted under a path, it answers a 500 and logs why. To serve the api under a prefix, set `mount: /api` on the target entry instead.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix. A client resolves them against the URL it called, not the API base URL.

Check your variables once at start, with your validator, and stop when one is missing. Keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files.

## Express 4

Install `express@4` and `@types/express@4` instead. The generated code and the handlers are the same.

## Wiring reference

Every server target takes four options: `bodyValidation` (check request bodies, off by default), `frameworkEtag` (`strip` by default removes an ETag the framework adds to a reply your code wrote outside the contract; `keep` leaves it), `catchAll` (`true` by default answers the api's 404 for a path under its base path that no route serves, or a method it does not serve; `false` leaves those requests to your app) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it. When you register the api, `logger: { warn, error }` sends the messages seampact writes (such as that log) to your logger instead of `console`; the logger is shared by the whole generated api, so the last registration wins.

Mount the generated router, then its error middleware for requests refused before a route matched. The router keeps the raw bytes of signed routes itself; a JSON parser you mount app-wide before it must use the generated `keepRawBody`.

```ts
app.use(TasksExpress.router({ handlers: { TasksEndpoints: tasksHandlers }, hooks: tasksHooks() }));
app.use(TasksExpress.preRoutingErrorHandler);
```

Next: [run it](../getting-started/03-generate-and-run.md#run-it).

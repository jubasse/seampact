# Write the handlers (Hono)

This page replaces the NestJS page. Two earlier pages change when you use Hono 4 on Node.

In [Install](../getting-started/01-install.md), use these dependencies in `package.json`. You do not need `experimentalDecorators` in `tsconfig.json`.

```json
  "dependencies": {
    "@hono/node-server": "2.1.5",
    "hono": "4.13.13",
    "zod": "4.6.7"
  },
```

Keep `@seampact/server-runtime`, which Install put in `dependencies`: the generated code imports it. Keep it at the version of your other seampact packages.

In [Generate](../getting-started/03-generate-and-run.md), the `server` target uses `@seampact/codegen-hono`. It has no `bodyValidation` option.

```yaml
  - id: server
    use: "@seampact/codegen-hono"
    apis: [notes]
    link:
      types: types
      validators: validators
```

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows; `Notes.Status` and `Notes.ErrorCode` name them. Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesHono from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesEndpoints: NotesHono.NotesEndpoints = {
  listNotes() {
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

Types come from `types/notes`. The handlers interface and `registerRoutes` come from `server/notes`.

Create `src/main.ts`. A public api needs no hooks. `onError` makes a failing handler answer in the contract's error format. `checkFrameworkRoutes` must run after the last route is added and before the app serves.

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as NotesHono from "./__generated__/server/notes/index.js";
import { notesEndpoints } from "./notes-handlers.js";

const app = new Hono();

app.onError((error, c) => NotesHono.renderContractError(c, error));

NotesHono.registerRoutes(app, { handlers: { NotesEndpoints: notesEndpoints } });

NotesHono.checkFrameworkRoutes(app);

serve({ fetch: app.fetch, port: 3000 });
```

Typecheck.

```sh
npx tsc -p .
```

You see no output.

A throttler's 429 works out of the box with `hono-rate-limiter`. When the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the throttler's `Retry-After` (seconds or an HTTP date), read from the reply or from the exception. Without a usable `Retry-After`, the reply is a logged 500 (with an optional `retryAfterMs`, the code is answered without it) that names the fix: answer the code from the handler with its params.

## Behind a reverse proxy and in Docker

Hono has no trust-proxy setting. Behind a proxy, `getConnInfo` gives the proxy's address: in `clientAddress`, read the last `X-Forwarded-For` entry instead, and only when the request comes from your proxy. Your hooks get the address it returns.

The proxy forwards the contract's paths as they are (`/v1/notes`): strip only a prefix you added in front, such as `/api`. Call `registerRoutes` on an app without `basePath()`: a base path is refused at boot. To serve the api under a prefix, set `mount: /api` on the target entry instead.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix. A client resolves them against the URL it called, not the API base URL.

Check your variables once at start, with your validator, and stop when one is missing. Keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files.

## Wiring reference

Every server target takes four options: `bodyValidation` (check request bodies, off by default), `frameworkEtag` (`strip` by default removes an ETag the framework adds to a reply your code wrote outside the contract; `keep` leaves it), `catchAll` (`true` by default answers the api's 404 for a path under its base path that no route serves, or a method it does not serve; `false` leaves those requests to your app) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it. When you register the api, `logger: { warn, error }` sends the messages seampact writes (such as that log) to your logger instead of `console`; the logger is shared by the whole generated api, so the last registration wins.

Register the routes on the app that serves, and pass the client address your runtime gives (here `@hono/node-server`). The boundary reads the raw bytes of signed routes itself; render refusals raised before a route ran from your `onError`.

```ts
TasksHono.registerRoutes(app, {
  handlers: { TasksEndpoints: tasksHandlers },
  hooks: tasksHooks(),
  clientAddress: (c) => getConnInfo(c).remote.address,
});
app.onError(async (error, c) => (await TasksHono.renderPreRoutingError(c, error)) ?? c.text("error", 500));
```

Next: [run it](../getting-started/03-generate-and-run.md#run-it).

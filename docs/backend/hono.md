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

## Wiring reference

Every server target takes three options: `bodyValidation` (check request bodies, off by default), `frameworkEtag` (`strip` by default removes an ETag the framework adds to a reply your code wrote outside the contract; `keep` leaves it) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it.

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

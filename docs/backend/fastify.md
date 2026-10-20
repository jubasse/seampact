# Write the handlers (Fastify)

This page replaces the NestJS page. The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows; `Notes.Status` and `Notes.ErrorCode` name them. You pass your handlers to the generated Fastify plugin, which checks the access, the input and the reply around them.

## Dependencies and config

Do this in [Install](../getting-started/01-install.md), before `install-into`. In `package.json`, use these `dependencies` and keep the `devDependencies`.

```json
{
  "dependencies": {
    "ajv": "8.20.0",
    "fastify": "5.12.7"
  }
}
```

In `tsconfig.json`, leave out `experimentalDecorators`: Fastify has no decorators.

In [Generate](../getting-started/03-generate-and-run.md), use this `targets` list in `seampact.config.yaml`. The Fastify target checks bodies with Ajv validators it generates, so there is no `validators` entry and no `zod`.

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-fastify"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
```

Then run `npx seampact generate` as in [Generate](../getting-started/03-generate-and-run.md).

## The handlers

Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import * as NotesFastify from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesHandlers: NotesFastify.NotesEndpoints = {
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

Types come from `types/notes`. The handler interface and the plugin come from `server/notes`.

## The app

Create `src/main.ts`. A public api needs no hooks. `collectFrameworkRoutes` must come right after `Fastify()`: the plugin uses it at startup to find routes you add outside the contract. The not-found handler answers unknown routes in the contract's error format.

```ts
import Fastify from "fastify";
import * as NotesFastify from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";

const app = Fastify();

NotesFastify.collectFrameworkRoutes(app);

await app.register(NotesFastify.plugin, { handlers: { NotesEndpoints: notesHandlers } });

app.setNotFoundHandler((request, reply) => {
  if (NotesFastify.renderPreRoutingError(request, reply)) return;

  reply.code(404).send({ message: "not found" });
});

await app.listen({ port: 3000 });
```

Typecheck.

```sh
npx tsc -p .
```

You see no output.

## Wiring reference

Every server target takes four options: `bodyValidation` (check request bodies, off by default), `frameworkEtag` (`strip` by default removes an ETag the framework adds to a reply your code wrote outside the contract; `keep` leaves it), `catchAll` (`true` by default answers the api's 404 for a path under its base path that no route serves, or a method it does not serve; `false` leaves those requests to your app) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it. When you register the api, `logger: { warn, error }` sends the messages seampact writes (such as that log) to your logger instead of `console`; the logger is shared by the whole generated api, so the last registration wins. Fastify also takes `compression`: when `@fastify/compress` is registered, replies of 1024 bytes or more are compressed; `compression: off` never compresses them, and `compression: { thresholdBytes: 4096 }` moves the threshold.

Register the generated plugin. It keeps the raw bytes of signed routes itself.

```ts
await app.register(TasksFastify.plugin, { handlers: { TasksEndpoints: tasksHandlers }, hooks: tasksHooks() });
```

Next: [run it](../getting-started/03-generate-and-run.md#run-it).

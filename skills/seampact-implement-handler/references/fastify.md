<!-- Generated from docs/backend/fastify.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Fastify

Page: https://jubasse.github.io/seampact/backend/fastify/

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesFastify from "./__generated__/server/notes/index.js";
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

### Who is calling

When an operation has an identity, its `input` also has `principal`: what your authenticate hook returned. When it runs in a scope, `input.scopes` has one entry per scope, as your resolver returned it (the scope's `value` is `unknown`: narrow it). Both are read-only and are left out when you spread or serialise `input`. Type the parameter with `HandlerInputs`.

```ts
getNote(input: NotesFastify.HandlerInputs["getNote"]) {
  const ownerId = input.principal.userId;
  const workspaceId = input.scopes.workspace.id;
```

A public operation has no `principal`, and an operation in no scope has no `scopes`.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

## Wire it in

Create `src/main.ts`.

```ts
import Fastify from "fastify";
import * as NotesFastify from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = Fastify();

NotesFastify.collectFrameworkRoutes(app);

await app.register(NotesFastify.plugin, {
  handlers: { NotesEndpoints: notesHandlers },
  hooks: notesHooks(),
});

app.setNotFoundHandler((request, reply) => {
  if (NotesFastify.renderPreRoutingError(request, reply)) return;

  reply.code(404).send({ message: "not found" });
});

await app.listen({ port: 3000 });
```

- `collectFrameworkRoutes` must come right after `Fastify()`. The plugin uses it at start to find the routes you add outside the contract.
- Register the plugin without a prefix. Another prefix is refused at boot.
- The not-found handler answers unknown routes in the contract's error format.
- For a public api, leave `hooks` out.

Check the types.

```sh
npx tsc -p .
```

You see no output.

<!-- Generated from docs/backend/express.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Express

Page: https://jubasse.github.io/seampact/backend/express/

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-handlers.ts`.

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

### Who is calling

When an operation has an identity, its `input` also has `principal`: what your authenticate hook returned. When it runs in a scope, `input.scopes` has one entry per scope, as your resolver returned it (the scope's `value` is `unknown`: narrow it). Both are read-only and are left out when you spread or serialise `input`. Type the parameter with `HandlerInputs`.

```ts
getNote(input: NotesExpress.HandlerInputs["getNote"]) {
  const ownerId = input.principal.userId;
  const workspaceId = input.scopes.workspace.id;
```

A public operation has no `principal`, and an operation in no scope has no `scopes`.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

## Wire it in

Create `src/main.ts`. Mount the router at the root of the app, without a path: the contract paths already start with `/v1`.

```ts
import express from "express";
import * as NotesExpress from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = express();

app.use(NotesExpress.router({ handlers: { NotesEndpoints: notesHandlers }, hooks: notesHooks() }));
app.use(NotesExpress.preRoutingErrorHandler);

NotesExpress.checkFrameworkRoutes(app);

app.listen(3000);
```

- `router` parses JSON itself, so bad JSON and unknown routes answer in the contract's error format. For a public api, leave `hooks` out.
- `preRoutingErrorHandler` does the same for errors raised by middleware you mount before the router, such as `express.json()` or a rate limiter. A JSON parser you mount before the router needs `verify: NotesExpress.keepRawBody` and `limit: NotesExpress.LARGEST_BODY_LIMIT`.
- `checkFrameworkRoutes` checks the routes you add outside the contract. Express has no start hook: call it once every route is mounted, before `listen`. It throws and names the route it refuses.

Check the types.

```sh
npx tsc -p .
```

You see no output.

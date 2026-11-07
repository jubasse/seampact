<!-- Generated from docs/backend/hono.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Hono

Page: https://jubasse.github.io/seampact/backend/hono/

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-handlers.ts`.

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

### Who is calling

When an operation has an identity, its `input` also has `principal`: what your authenticate hook returned. When it runs in a scope, `input.scopes` has one entry per scope, as your resolver returned it (the scope's `value` is `unknown`: narrow it). Both are read-only and are left out when you spread or serialise `input`. Type the parameter with `HandlerInputs`.

```ts
getNote(input: NotesHono.HandlerInputs["getNote"]) {
  const ownerId = input.principal.userId;
  const workspaceId = input.scopes.workspace.id;
```

A public operation has no `principal`, and an operation in no scope has no `scopes`.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

## Wire it in

Create `src/main.ts`.

```ts
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import * as NotesHono from "./__generated__/server/notes/index.js";
import { notesEndpoints } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = new Hono();

app.onError((error, c) => NotesHono.renderContractError(c, error));

NotesHono.registerRoutes(app, {
  handlers: { NotesEndpoints: notesEndpoints },
  hooks: notesHooks(),
  clientAddress: (c) => getConnInfo(c).remote.address,
});

NotesHono.checkFrameworkRoutes(app);

serve({ fetch: app.fetch, port: 3000 });
```

- `onError` makes a failing handler answer in the contract's error format.
- `clientAddress` gives your hooks the caller's address. Without it, they get none.
- Call `registerRoutes` on an app without `basePath()`. A base path is refused at boot.
- `checkFrameworkRoutes` must run after the last route is added and before the app serves.
- For a public api, leave `hooks` out.

If your own middleware answers 401, 403 or 429 on a contract route, render it in the contract's format with `renderPreRoutingError`:

```ts
app.onError(async (error, c) => (await NotesHono.renderPreRoutingError(c, error)) ?? NotesHono.renderContractError(c, error));
```

Check the types.

```sh
npx tsc -p .
```

You see no output.

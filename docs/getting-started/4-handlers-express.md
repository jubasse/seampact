# 4. Write the handlers (Express)

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows; `Notes.Status` and `Notes.ErrorCode` name them. You need the Express target from step 3: `@seampact/codegen-express`.

Add Express to the app.

```sh
pnpm add express@5 && pnpm add -D @types/express@5
```

You see pnpm add both packages. The NestJS packages from step 1 stay unused; `pnpm remove @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs` drops them.

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

## Express 4

Install `express@4` and `@types/express@4` instead. The generated code and the handlers are the same.

Next: [5. Run it](5-run.md)

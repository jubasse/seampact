<!-- Generated from docs/backend/nextjs.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Next.js

Page: https://jubasse.github.io/seampact/backend/nextjs/

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes. Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesNext from "./__generated__/server/notes";
import * as Notes from "./__generated__/types/notes";

const notes = new Map<string, Notes.schemas.Note>();

export const notesEndpoints: NotesNext.NotesEndpoints = {
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

When an operation has an identity, its `input` also has `principal`, and when it runs in a scope, `input.scopes`. See [Who is calling](https://jubasse.github.io/seampact/backend/hono/#who-is-calling): it works the same way.

## Wire it in

Build the route handler's options once, in `src/notes-route.ts`.

```ts
import { notesEndpoints } from "./notes-handlers";
import { notesHooks } from "./notes-hooks";

export const notesRouteOptions = {
  handlers: { NotesEndpoints: notesEndpoints },
  hooks: notesHooks(),
  clientAddress: (request: Request) =>
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim(),
};
```

Then create the catch-all route file under the api's base path, `src/app/v1/[[...path]]/route.ts`.

```ts
import { routeHandler } from "@/__generated__/server/notes";
import { notesRouteOptions } from "@/notes-route";

export const runtime = "nodejs";

const handler = routeHandler(notesRouteOptions);

export { handler as DELETE, handler as GET, handler as HEAD, handler as OPTIONS, handler as PATCH, handler as POST, handler as PUT };
```

- Export the handler under every method name. A method the contract does not serve then answers the contract's 404, not Next.js's 405.
- `runtime = "nodejs"` is required. On the Edge runtime the route fails to load. If your app sets `cacheComponents: true`, remove this line: Next.js refuses it there, and the route runs on Node.js.
- An api with several base paths needs one route file per base path, each importing the same options.
- For a public api, leave `hooks` out.
- `clientAddress` gives your hooks the caller's address. Without it, they get none. A `Request` does not carry it: behind a proxy, read the last `X-Forwarded-For` entry, as above, and only when the request comes from your proxy. The client writes the earlier entries.

Check the types.

```sh
npx tsc -p .
```

You see no output.

Build and start the app. Turbopack and webpack both work: the generated imports have no extension.

```sh
npx next build
npx next start
```

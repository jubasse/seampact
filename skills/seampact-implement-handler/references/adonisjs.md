<!-- Generated from docs/backend/adonisjs.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# AdonisJS

Page: https://jubasse.github.io/seampact/backend/adonisjs/

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. An AdonisJS controller is a class with a default export. Create `app/controllers/notes_controller.ts`.

```ts
import { randomUUID } from 'node:crypto'
import type * as NotesAdonis from '../../src/__generated__/server/notes/index.js'
import * as Notes from '../../src/__generated__/types/notes/index.js'

const notes = new Map<string, Notes.schemas.Note>()

export default class NotesController implements NotesAdonis.NotesEndpoints {
  listNotes(input: Notes.ListNotesInput) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } }
  }

  getNote(input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId)

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound }

    return { status: Notes.Status.Ok, body: note }
  }

  createNote(input: Notes.CreateNoteInput) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body }

    notes.set(note.noteId, note)

    return { status: Notes.Status.Created, body: note }
  }

  deleteNote(input: Notes.DeleteNoteInput) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound }

    return { status: Notes.Status.NoContent }
  }
}
```

### Who is calling

When an operation has an identity, its `input` also has `principal`: what your authenticate hook returned. When it runs in a scope, `input.scopes` has one entry per scope, as your resolver returned it (the scope's `value` is `unknown`: narrow it). Both are read-only and are left out when you spread or serialise `input`. Type the parameter with `HandlerInputs`.

```ts
getNote(input: NotesAdonis.HandlerInputs['getNote']) {
  const ownerId = input.principal.userId
  const workspaceId = input.scopes.workspace.id
```

A public operation has no `principal`, and an operation in no scope has no `scopes`.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

## Wire it in

Replace `start/routes.ts`. Pass your hooks as `hooks`; for a public api, leave them out.

```ts
import router from '@adonisjs/core/services/router'
import * as NotesAdonis from '../src/__generated__/server/notes/index.js'
import { notesHooks } from '../src/notes-hooks.js'

NotesAdonis.registerRoutes(router, {
  controllers: { NotesEndpoints: () => import('#controllers/notes_controller') },
  hooks: notesHooks(),
})
```

- `controllers` has one entry per generated `*Endpoints` interface. Each is a lazy import of a module whose default export is your controller class.
- Call `registerRoutes` outside any `router.group()` with a prefix: a contract route under a prefix answers 500 and reports why.
- A route of yours beside the contract's must stay off the api's paths (`/v1`), unless `frameworkRoutes` allow-lists it.
- The starter already registers the body parser (`@adonisjs/core/bodyparser_middleware`) as router middleware and accepts `application/json`, which the generated routes need. Without that, every route that takes a body answers 500. Signed routes read the raw body through it.

Edit `app/exceptions/handler.ts` so bad JSON and unknown routes under `/v1` answer in the contract's error format. Add the import at the top, and the `if` line in `handle`. With several apis, call each api's helper.

```ts
import * as NotesAdonis from '../../src/__generated__/server/notes/index.js'
```

```ts
  async handle(error: unknown, ctx: HttpContext) {
    if (await NotesAdonis.renderPreRoutingError(error, ctx)) return undefined

    return super.handle(error, ctx)
  }
```

Check the types.

```sh
npx tsc --noEmit
```

You see no output.

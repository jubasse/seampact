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

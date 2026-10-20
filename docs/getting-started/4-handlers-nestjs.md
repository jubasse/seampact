# 4. Write the handlers (NestJS)

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows; `Notes.Status` and `Notes.ErrorCode` name them. Create `src/notes-controller.ts`.

```ts
import { randomUUID } from "node:crypto";
import { Controller } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

@Controller()
export class NotesController implements NotesNest.NotesEndpoints {
  @NotesNest.listNotes()
  listNotes(@NotesNest.listNotes.input() input: Notes.ListNotesInput) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  }

  @NotesNest.getNote()
  getNote(@NotesNest.getNote.input() input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  }

  @NotesNest.createNote()
  createNote(@NotesNest.createNote.input() input: Notes.CreateNoteInput) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  }

  @NotesNest.deleteNote()
  deleteNote(@NotesNest.deleteNote.input() input: Notes.DeleteNoteInput) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  }
}
```

`listNotes` returns every note; a real app reads `input.query.cursor` to page through them.

Types come from `types/notes`. Decorators and handlers come from `server/notes`.

Create `src/app-module.ts`. A public api needs no hooks.

```ts
import { Module } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { NotesController } from "./notes-controller.js";

@Module({
  imports: [NotesNest.SeampactModule.forRoot()],
  controllers: [NotesController],
})
export class AppModule {}
```

Create `src/main.ts`. The body parser and the filter make bad JSON and unknown routes answer in the contract's error format.

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { AppModule } from "./app-module.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

app.useBodyParser("json", { limit: NotesNest.LARGEST_BODY_LIMIT, strict: false });
app.useGlobalFilters(NotesNest.preRoutingFilter);

await app.listen(3000);
```

Typecheck.

```sh
npx tsc -p .
```

You see no output.

Next: [5. Run it](5-run.md)

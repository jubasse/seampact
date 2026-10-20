# 4. Write the handlers (NestJS)

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows, written `as const`. Create `src/notes-controller.ts`.

```ts
import { randomUUID } from "node:crypto";
import { Controller } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import type * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

@Controller()
export class NotesController implements NotesNest.NotesEndpoints {
  @NotesNest.listNotes()
  listNotes(@NotesNest.listNotes.input() input: Notes.ListNotesInput) {
    return { status: 200 as const, body: { items: [...notes.values()] } };
  }

  @NotesNest.getNote()
  getNote(@NotesNest.getNote.input() input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId);

    if (note === undefined) return { status: 404 as const, code: "api.not_found" as const };

    return { status: 200 as const, body: note };
  }

  @NotesNest.createNote()
  createNote(@NotesNest.createNote.input() input: Notes.CreateNoteInput) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: 201 as const, body: note };
  }

  @NotesNest.deleteNote()
  deleteNote(@NotesNest.deleteNote.input() input: Notes.DeleteNoteInput) {
    if (!notes.delete(input.path.noteId))
      return { status: 404 as const, code: "api.not_found" as const };

    return { status: 204 as const };
  }
}
```

`listNotes` returns every note; a real app reads `input.query.cursor` to page through them.

Types come from `types/notes`. Decorators and handlers come from `server/notes`.

Create `src/app-module.ts`. The empty hooks are enough because this api is public.

```ts
import { Module } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { NotesController } from "./notes-controller.js";

@Module({
  imports: [NotesNest.SeampactModule.forRoot({ authenticate: {}, deciders: [], scopeResolvers: {} })],
  controllers: [NotesController],
})
export class AppModule {}
```

Create `src/main.ts`. The body parser limit and the filter make malformed JSON and unknown routes under `/v1` answer in the contract's error format. Without the filter they answer with NestJS's own error body.

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

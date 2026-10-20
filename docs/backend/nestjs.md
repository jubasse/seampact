# Write the handlers (NestJS)

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

## Wiring reference

Every server target takes three options: `bodyValidation` (check request bodies, off by default), `frameworkEtag` (`strip` by default removes an ETag the framework adds to a reply your code wrote outside the contract; `keep` leaves it) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it.

Install `@nestjs/platform-express` (the Fastify platform is refused at boot), `reflect-metadata` and `rxjs`, and set `experimentalDecorators` in `tsconfig.json`. Import the generated module with your hooks, start the app with `rawBody: true` so signed routes see the bytes that were signed, and register `preRoutingFilter`. Without the filter, malformed JSON and unknown routes under the api's prefix answer with NestJS's own error body instead of the contract's format.

```ts
@Module({ imports: [TasksNest.SeampactModule.forRoot(tasksHooks())], controllers: [TasksController] })
export class AppModule {}

const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

app.useBodyParser("json", { limit: TasksNest.LARGEST_BODY_LIMIT, strict: false });
app.useGlobalFilters(TasksNest.preRoutingFilter);
```

For `@nestjs/swagger`, write the document with one call. It adds the contract schemas and stops the app if one of your classes replaces one. The setup is in [OpenAPI and docs](../configuration/openapi-and-docs.md).

```ts
const document = TasksNest.createContractDocument(app, config, { autoTagControllers: false });
```

Next: [run it](../getting-started/03-generate-and-run.md#run-it).

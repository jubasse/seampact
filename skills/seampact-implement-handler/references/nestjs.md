<!-- Generated from docs/backend/nestjs.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# NestJS

Page: https://jubasse.github.io/seampact/backend/nestjs/

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-controller.ts`.

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

Rules for a contract method:

- Keep `@Controller()` without a path, and do not add `@HttpCode` or `@Header`. The contract sets paths, statuses and headers, and the app refuses to start otherwise.
- A service can also throw. `throw new NotFoundException()` answers the operation's 404 code, when it declares one. For any declared code, throw `new NotesNest.ContractException(code, params)`: it is typed with the api's codes and their params. A plain `HttpException` for a code that needs params answers 500.
- seampact's filter catches these exceptions before your global filters, so a global `@Catch(NotFoundException)` filter does not see them on a contract route.

### Who is calling

`@<operation>.principal()` gives the caller: what your authenticate hook returned, typed with the identity's principal schema. `@<operation>.scopes()` gives one entry per scope, as your resolver returned it. A public operation has no `principal()`, and an operation in no scope has no `scopes()`.

```ts
@NotesNest.getNote()
getNote(
  @NotesNest.getNote.input() input: NotesNest.HandlerInputs["getNote"],
  @NotesNest.getNote.principal() principal: NotesNest.OperationAccess["getNote"]["principal"],
) {
  const ownerId = principal.userId;
```

The input typed with `HandlerInputs` carries the same `principal` and `scopes`, read-only. Spreading or serialising it leaves them out. The scope's `value` is `unknown`: narrow it.

### Read one part of the input

Instead of the whole input, take the parts you use: `@<operation>.path()`, `.query()`, `.headers()` and `.body()`. Each exists when the operation declares that part. The request is checked once, whichever parts you take.

```ts
@NotesNest.getNote()
getNote(@NotesNest.getNote.path() path: Notes.GetNoteInput["path"]) {
  const note = notes.get(path.noteId);
```

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

## Wire it in

Create `src/app-module.ts`. Pass your hooks to `forRoot`.

```ts
import { Module } from "@nestjs/common";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { NotesController } from "./notes-controller.js";
import { notesHooks } from "./notes-hooks.js";

@Module({
  imports: [NotesNest.SeampactModule.forRoot(notesHooks())],
  controllers: [NotesController],
})
export class AppModule {}
```

For a public api, write `forRoot()`. Import `forRoot` once per api.

Create `src/main.ts`. `configureApp` installs the JSON parser of the contract routes and the filter that make bad JSON and unknown routes answer in the contract's error format. Call it before `listen`.

```ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as NotesNest from "./__generated__/server/notes/index.js";
import { AppModule } from "./app-module.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule);

NotesNest.configureApp(app);

await app.listen(3000);
```

Check the types.

```sh
npx tsc -p .
```

You see no output.

### Hooks that need providers

When your hooks need NestJS providers, build them with `forRootAsync`.

```ts
NotesNest.SeampactModule.forRootAsync({
  imports: [UsersModule],
  inject: [UsersService],
  useFactory: (users: UsersService) => notesHooks(users),
});
```

### Your own JSON parser and filters

On the contract routes, `configureApp` reads JSON bodies at each route's limit, accepts a plain value such as `"text"` (the contract then checks it) and keeps the bytes of signed routes. Your own routes keep NestJS's default JSON parser: strict, 100 KB. To change it, pass its options: `configureApp(app, { appJsonParser: { limit: "5mb" } })`.

- Do not add a JSON parser of your own: the app refuses to start, because it would read the contract bodies first, or never run.
- With two apis, call each api's `configureApp`, and pass `appJsonParser` to the first call only.
- With a global filter of your own, do the steps yourself: `app.useBodyParser("json", { limit, strict: false, verify: NotesNest.keepRawBody })`, then call the api's `renderPreRoutingError` from your filter. A contract body that no parser read answers 500, with a log naming `configureApp`.

# Your first API

You write a contract in YAML. seampact generates the types, the zod validators and the NestJS routes. You write the handlers. At the end, a notes API runs on port 3000.

This walk-through uses NestJS. For another server, do steps 1 to 3 here, then follow its guide for the handlers: [Express](../backend/express.md), [Fastify](../backend/fastify.md), [AdonisJS](../backend/adonisjs.md), [Hono](../backend/hono.md), [Spring Boot](../backend/spring-boot.md), [Laravel](../backend/laravel.md), [Symfony](../backend/symfony.md), [FastAPI](../backend/fastapi.md), [Django REST Framework](../backend/drf.md) or [Django Ninja](../backend/ninja.md).

Run every command in the `notes-app` folder from [Install](01-install.md).

## 1. Add NestJS

```sh
npm install --save-exact @nestjs/common@12.1.3 @nestjs/core@12.1.3 @nestjs/platform-express@12.1.3 reflect-metadata@0.2.2 rxjs@7.8.2 zod@4.6.7
npm install --save-dev --save-exact @types/node@24.19.1 tsx@4.23.15 typescript@6.0.3
```

Create `tsconfig.json`. NestJS decorators need `experimentalDecorators`.

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "experimentalDecorators": true
  },
  "include": ["src"]
}
```

## 2. Write the contract

The contract describes one collection of records, `notes`, with four operations. Replace `contract/api.yaml`, which `init` wrote, with this file. Keep its first line, the editor modeline (`# yaml-language-server: ...`): it lets your editor check the contract.

```yaml
api:
  name: notes
  version: 1
  kind: product
  maturity: provisional
  summary: A small notes api.

pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
    response:
      body: $items
      links: { next: $next }

schemas:
  NoteId: { type: string, format: uuid }
  Note:
    type: object
    required: [noteId, title, createdAt]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }
      createdAt: { type: string, format: date-time }
  CreateNote:
    type: object
    required: [title]
    properties:
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }

surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops:
          list: { paging: { cursor: { maxLimit: 50 } } }
          get: {}
          create: { input: CreateNote }
          delete: {}
```

What each block does:

- `api` names the api and gives its version. `version: 1` makes the `/v1` in every path. `kind: product` says this is an API for end users and their clients; it is the default, and the other value is `service`, for an internal API with a caller identity. `maturity: provisional` says the API may still change; the values are `experimental`, `provisional` and `stable`.
- `pagings` defines how a list pages. Here a client sends `cursor` and `limit` in the query. The body is the array of records (`$items`) and the next page goes in a `Link` header (`$next`).
- `schemas` holds the shapes of your data. `Note` is what the API returns. `CreateNote` is what a client sends to create one.
- `surfaces` holds the routes under a path prefix. `/v{version}` becomes `/v1`. `access` says who may call them: `public` means anyone, and the sentence says why.
- `routes.notes` is a collection. `ops` picks the standard operations: `list` (`GET /v1/notes`, up to 50 records per page), `get` (`GET /v1/notes/{noteId}`), `create` (`POST /v1/notes`) and `delete` (`DELETE /v1/notes/{noteId}`).

A contract with one api needs no `workspace.yaml`: seampact reads `api.yaml` in the folder. [The shape of a contract](../contract/01-basics.md) explains each block further.

Check it.

```sh
npx seampact lint
```

You see `Linted 1 api(s): 0 error(s), 0 warning(s).`

## 3. Generate the code

The config tells seampact where the contract is and what to generate. Replace `seampact.config.yaml`, which `init` wrote, with this file.

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: validators
    use: "@seampact/codegen-zod"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-nestjs"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

- `sources.notes.path` is the folder of the contract. `apis: [notes]` names the api inside it, which is the `api.name` of the contract.
- Each entry of `targets` is one kind of output. `use` names its generator package.
- `link` tells the server entry which entries hold its types and its validators.
- `bodyValidation: true` also checks the bodies your own code writes outside a handler result.

Every key is in [the config reference](../configuration/reference.md).

```sh
npx seampact generate
```

You see one line per target. The files appear in `src/__generated__`, and the OpenAPI document in `openapi/notes.yaml`. Commit them: `seampact check` fails later if they drift from the contract. Never edit `src/__generated__` by hand.

## 4. Write the handlers

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows. `Notes.Status` and `Notes.ErrorCode` name them. Types come from `types/notes`. Decorators and the module come from `server/notes`.

Create `src/notes-controller.ts`. It holds your handlers. This one keeps the notes in memory.

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

`listNotes` returns every note. A real app reads `input.query.cursor` to page through them. Keep `@Controller()` without a path: the contract sets the paths, the statuses and the headers.

Create `src/app-module.ts`. It mounts the generated module and your controller. A public api needs no hooks.

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

Create `src/main.ts`. `configureApp` installs the JSON parser and the filter that make bad JSON and unknown routes answer in the contract's error format. Your own routes keep NestJS's default JSON parser.

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

Typecheck.

```sh
npx tsc -p .
```

You see no output. If your handlers drift from the contract, this is where the compiler tells you.

## 5. Run it

Start the app.

```sh
npx tsx src/main.ts
```

In another terminal, create a note.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":"Buy milk"}'
```

You see `201` and the note with its `noteId`. `curl localhost:3000/v1/notes` lists it.

Send an empty title.

```sh
curl -i -X POST localhost:3000/v1/notes -H 'content-type: application/json' -d '{"title":""}'
```

You see `400` and an `application/problem+json` body whose `issues` names `/title`. The generated validators refused it before your handler ran.

AdonisJS starts with `node ace serve` instead of `tsx`.

Something fails? See [troubleshooting](../troubleshooting/README.md).

Next: [call it from React](call-it-from-react.md). More on NestJS (access hooks, tests, Docker): [the NestJS guide](../backend/nestjs.md).

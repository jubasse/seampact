# Getting started: a notes API on NestJS

You write a contract in YAML. seampact generates the types, the zod validators and the NestJS routes. You write the handlers. At the end, a notes API runs on port 3000.

You need Node.js 24 or later, pnpm, and a checkout of this repository. Nothing is published to npm yet, so step 1 installs seampact from packed files.

## 1. Create the app and install seampact

Build and pack the seampact packages from your checkout into the app's `vendor` folder.

```sh
SEAMPACT=~/src/seampact   # your checkout
APP=~/src/notes-app
mkdir -p "$APP/vendor" "$APP/contract" "$APP/src"

cd "$SEAMPACT" && pnpm install --frozen-lockfile
for dir in packages/*/*/; do
  [ -f "$dir/tsconfig.build.json" ] || continue
  (cd "$dir" && "$SEAMPACT/node_modules/.bin/tsc" -p tsconfig.build.json && pnpm pack --silent --pack-destination "$APP/vendor")
done
```

You see 21 `seampact-*.tgz` files in `$APP/vendor`.

Create `$APP/package.json`.

```json
{
  "name": "notes-app",
  "private": true,
  "type": "module",
  "dependencies": {
    "@nestjs/common": "12.1.3",
    "@nestjs/core": "12.1.3",
    "@nestjs/platform-express": "12.1.3",
    "@seampact/cli": "file:./vendor/seampact-cli-0.0.0.tgz",
    "@seampact/codegen-nestjs": "file:./vendor/seampact-codegen-nestjs-0.0.0.tgz",
    "@seampact/codegen-ts": "file:./vendor/seampact-codegen-ts-0.0.0.tgz",
    "@seampact/codegen-zod": "file:./vendor/seampact-codegen-zod-0.0.0.tgz",
    "@seampact/hooks": "file:./vendor/seampact-hooks-0.0.0.tgz",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@types/node": "24.19.1",
    "tsx": "4.23.15",
    "typescript": "6.0.3"
  }
}
```

The seampact packages depend on each other, and npm has none of them. So pnpm must resolve every one from `vendor`. This script writes that list, then you install.

```sh
cd "$APP"
{
  echo "allowBuilds:"
  echo "  esbuild: true"
  echo "overrides:"
  for file in vendor/*.tgz; do
    name=$(basename "$file" .tgz); name=${name%-*}
    echo "  \"@seampact/${name#seampact-}\": \"file:./$file\""
  done
} > pnpm-workspace.yaml
pnpm install
```

Create `$APP/tsconfig.json`. NestJS decorators need `experimentalDecorators`.

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

The contract describes one collection, `notes`, with four operations. Create `contract/api.yaml`.

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

A contract with one api needs no `workspace.yaml`: seampact reads `api.yaml` in the folder. A list must name its paging style, and `access` says who may call the routes.

Check it.

```sh
npx seampact lint
```

You see `Linted 1 api(s): 0 error(s), 0 warning(s).`

## 3. Generate the code

The config tells seampact where the contract is and what to generate. Create `seampact.config.yaml`.

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

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__` and `openapi/notes.yaml`. Commit them: `seampact check` fails later if they drift from the contract.

## 4. Write the handlers

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
    const all = [...notes.values()];
    const start = input.query.cursor === undefined ? 0 : Number(input.query.cursor);
    const limit = input.query.limit ?? 50;
    const items = all.slice(start, start + limit);
    const next = start + limit < all.length ? { nextCursor: String(start + limit) } : {};

    return { status: 200 as const, body: { items, ...next } };
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

## 5. Run it

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

You see `400` and a `application/problem+json` body whose `issues` names `/title`.

## 6. Check a change

Save the current contract as a baseline, then edit the contract.

```sh
npx seampact compile --out baseline
```

Add `author` to `CreateNote`: `required: [title, author]` and `author: { type: string }` under `properties`. Then compare.

```sh
npx seampact diff --against baseline
```

You see `breaking clients createNote input ...: property.added required (author)`: existing clients do not send `author`. The gate passes because the contract sets no `compat` policy; add `compat: { policy: additive-only }` under `api:` and the gate fails.

`npx seampact check` now fails with `check.generated.drift` until you run `npx seampact generate`.

## When something fails

| You see | Do |
|---|---|
| `ERR_PNPM_FETCH_404 @seampact/...` | The package is missing from `pnpm-workspace.yaml` `overrides`: rerun the script in step 1. |
| `config.source.no-workspace` | The `path` folder holds neither `workspace.yaml` nor `api.yaml`. |
| `check.generated.drift ... edited by hand` | Move your code out of `src/__generated__`, delete the edited file, run `generate`. |
| Boot error `framework route ... not allow-listed` | List the route under `frameworkRoutes` of the server target, with a reason. |
| `cli.not-available` | The command (`init`, `bundle`, `explain`) is planned. |

Next: `docs/grammar/` describes every contract key, and [`docs/grammar/example.md`](grammar/example.md) is a full contract.

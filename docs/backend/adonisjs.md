# Write the handlers (AdonisJS 7)

Use this page instead of [the NestJS page](nestjs.md). [Install](../getting-started/01-install.md) and [Generate](../getting-started/03-generate-and-run.md) change a little for AdonisJS, so start with three set-up changes. The contract, the run and the checks stay the same, except that the app listens on port 3333 unless you change it (below).

## Set up the app

Install: create the app with the AdonisJS API starter instead of the `package.json` of [Install](../getting-started/01-install.md). Answer the prompts with the defaults.

```sh
mkdir -p ~/src && cd ~/src
npm init adonisjs@latest notes-app -- --kit=api --pkg=pnpm
cd notes-app
```

Install seampact from your checkout, as in [Install](../getting-started/01-install.md). Replace `~/src/seampact` with the path of your checkout.

```sh
cd ~/src/seampact && pnpm install --frozen-lockfile
node ~/src/seampact/scripts/consumers/install-into.ts ~/src/notes-app
cd ~/src/notes-app
```

You see `install-into: 21 packages in .../vendor/seampact`.

`install-into` rewrites `pnpm-workspace.yaml` and drops the starter's `allowBuilds`. Open the file and add these two lines under `allowBuilds:`, then install.

```yaml
  '@swc/core': true
  better-sqlite3: true
```

```sh
pnpm install
```

The starter already depends on `@vinejs/vine`. The generated server validates with it, so you need no validators entry. It uses VineJS's own rules; set `rules: seampact-consistent` in the server's `options` to get the contract's exact checks, as [Validators](../configuration/validators.md#vinejs) explains.

Install, `tsconfig.json`: the generated code does not compile with the starter's `lib` and unused-variable checks. Replace `tsconfig.json`.

```json
{
  "extends": "@adonisjs/tsconfig/tsconfig.app.json",
  "compilerOptions": {
    "rootDir": "./",
    "jsx": "react",
    "outDir": "./build",
    "lib": ["ES2024"],
    "noUnusedLocals": false,
    "noUnusedParameters": false
  }
}
```

Contract: write `contract/api.yaml` as in [Write the contract](../getting-started/02-first-contract.md).

Generate: create `seampact.config.yaml`. There is no `validators` entry, and the server target is `@seampact/codegen-adonis`.

```yaml
outDir: src/__generated__
sources:
  notes:
    path: ./contract
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: server
    use: "@seampact/codegen-adonis"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
```

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__` and `openapi/notes.yaml`.

## Write the controller

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows; `Notes.Status` and `Notes.ErrorCode` name them. An AdonisJS controller is a class with a default export. Create `app/controllers/notes_controller.ts`.

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

`listNotes` returns every note; a real app reads `input.query.cursor` to page through them.

Types come from `types/notes`. The routes come from `server/notes`.

## Register the routes

The starter's own routes (`/`, signup, login) are not in the contract, and the boot check refuses them. Replace `start/routes.ts`. A public api needs no hooks.

```ts
import router from '@adonisjs/core/services/router'
import * as NotesAdonis from '../src/__generated__/server/notes/index.js'

NotesAdonis.registerRoutes(router, {
  controllers: { NotesEndpoints: () => import('#controllers/notes_controller') },
})
```

The starter already registers the body parser as router middleware and accepts `application/json`, which the generated routes need.

## Answer bad requests in the contract's format

Edit `app/exceptions/handler.ts`. The generated helper makes bad JSON and unknown routes under `/v1` answer in the contract's error format. Add the import at the top and the `if` line in `handle`.

```ts
import * as NotesAdonis from '../../src/__generated__/server/notes/index.js'
```

```ts
  async handle(error: unknown, ctx: HttpContext) {
    if (await NotesAdonis.renderPreRoutingError(error, ctx)) return undefined

    return super.handle(error, ctx)
  }
```

## Pick the port

AdonisJS listens on port 3333. The run step uses 3000. In `.env`, set `PORT=3000`.

## Typecheck

```sh
npx tsc --noEmit
```

You see no output.

## Behind a reverse proxy and in Docker

Trust only your proxy's addresses in `config/app.ts`, so `request.ip()` is the caller's:

```ts
export const http = defineConfig({
  trustProxy: proxyAddr.compile(["10.0.0.0/8"]),
});
```

The client address your hooks get is `request.ip()`, so it follows this setting. AdonisJS 6 trusts loopback proxies by default.

The proxy forwards the contract's paths as they are (`/v1/notes`): strip only a prefix you added in front, such as `/api`. Call `registerRoutes` outside any `router.group()` with a prefix: a contract route under a prefix answers a 500 and reports why.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix. A client resolves them against the URL it called, not the API base URL.

`start/env.ts` checks your variables when the app boots. Keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files.

## What changes for AdonisJS 6

Nothing in this page: the same generated code and the same files run on AdonisJS 6. Only the starter you create differs.

## Wiring reference

Every server target takes four options: `bodyValidation` (check request bodies, off by default), `frameworkEtag` (`strip` by default removes an ETag the framework adds to a reply your code wrote outside the contract; `keep` leaves it), `catchAll` (`true` by default answers the api's 404 for a path under its base path that no route serves, or a method it does not serve; `false` leaves those requests to your app) and `responses`, which decides what happens when your handler answers something the contract does not declare: `strict` (the default) replaces the reply with a 500 in the api's format, `warn` lets it through and logs it. When you register the api, `logger: { warn, error }` sends the messages seampact writes (such as that log) to your logger instead of `console`; the logger is shared by the whole generated api, so the last registration wins.

Register `@adonisjs/core/bodyparser_middleware` as router middleware and list the route's media type in `json.types` of the body parser config: without it every route that takes a body answers 500, failing closed. Register the routes from `start/routes`, one `controllers` entry per generated `*Endpoints` interface, each a lazy import of a module whose default export is your controller class implementing that interface. Signed routes read the raw body through the body parser.

```ts
TasksAdonis.registerRoutes(router, {
  controllers: { TasksEndpoints: () => import("#controllers/tasks_controller") },
  hooks: tasksHooks(),
});
```

In `app/exceptions/handler`, call the generated helper first, once per api:

```ts
override async handle(error: unknown, ctx: HttpContext) {
  if (await TasksAdonis.renderPreRoutingError(error, ctx)) return undefined;

  return super.handle(error, ctx);
}
```

Next: [run it](../getting-started/03-generate-and-run.md#run-it). Start the app with `node ace serve` instead of `npx tsx src/main.ts`.

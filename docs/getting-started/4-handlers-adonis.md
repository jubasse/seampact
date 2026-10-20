# 4. Write the handlers (AdonisJS 7)

Use this page instead of [4. Write the handlers (NestJS)](4-handlers-nestjs.md). Steps 1 and 3 change a little for AdonisJS, so start with three set-up changes. Steps 2, 5 and 6 stay the same, except that the app listens on port 3333 unless you change it (below).

## Set up the app

Step 1: create the app with the AdonisJS API starter instead of the `package.json` of step 1. Answer the prompts with the defaults.

```sh
mkdir -p ~/src && cd ~/src
npm init adonisjs@latest notes-app -- --kit=api --pkg=pnpm
cd notes-app
```

Install seampact from your checkout, as in step 1. Replace `~/src/seampact` with the path of your checkout.

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

The starter already depends on `@vinejs/vine`. The generated server validates with it, so you need no validators entry.

Step 1, `tsconfig.json`: the generated code does not compile with the starter's `lib` and unused-variable checks. Replace `tsconfig.json`.

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

Step 2: write `contract/api.yaml` as in [2. Write the contract](2-contract.md).

Step 3: create `seampact.config.yaml`. There is no `validators` entry, and the server target is `@seampact/codegen-adonis`.

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

The generated `NotesEndpoints` interface lists one method per operation. Each method returns the status and body the contract allows, written `as const`. An AdonisJS controller is a class with a default export. Create `app/controllers/notes_controller.ts`.

```ts
import { randomUUID } from 'node:crypto'
import type * as NotesAdonis from '../../src/__generated__/server/notes/index.js'
import type * as Notes from '../../src/__generated__/types/notes/index.js'

const notes = new Map<string, Notes.schemas.Note>()

export default class NotesController implements NotesAdonis.NotesEndpoints {
  listNotes(input: Notes.ListNotesInput) {
    return { status: 200 as const, body: { items: [...notes.values()] } }
  }

  getNote(input: Notes.GetNoteInput) {
    const note = notes.get(input.path.noteId)

    if (note === undefined) return { status: 404 as const, code: 'api.not_found' as const }

    return { status: 200 as const, body: note }
  }

  createNote(input: Notes.CreateNoteInput) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body }

    notes.set(note.noteId, note)

    return { status: 201 as const, body: note }
  }

  deleteNote(input: Notes.DeleteNoteInput) {
    if (!notes.delete(input.path.noteId))
      return { status: 404 as const, code: 'api.not_found' as const }

    return { status: 204 as const }
  }
}
```

`listNotes` returns every note; a real app reads `input.query.cursor` to page through them.

Types come from `types/notes`. The routes come from `server/notes`.

## Register the routes

The starter's own routes (`/`, signup, login) are not in the contract, and the boot check refuses them. Replace `start/routes.ts`. The empty hooks are enough because this api is public.

```ts
import router from '@adonisjs/core/services/router'
import * as NotesAdonis from '../src/__generated__/server/notes/index.js'

NotesAdonis.registerRoutes(router, {
  controllers: { NotesEndpoints: () => import('#controllers/notes_controller') },
  hooks: { authenticate: {}, deciders: [], scopeResolvers: {} },
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

AdonisJS listens on port 3333. Step 5 uses 3000. In `.env`, set `PORT=3000`.

## Typecheck

```sh
npx tsc --noEmit
```

You see no output.

## What changes for AdonisJS 6

Nothing in this page: the same generated code and the same files run on AdonisJS 6. Only the starter you create differs.

Next: [5. Run it](5-run.md). Start the app with `node ace serve` instead of `npx tsx src/main.ts`.

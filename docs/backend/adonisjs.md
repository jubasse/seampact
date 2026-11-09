# AdonisJS

`@seampact/codegen-adonis` generates the routes of the contract on the AdonisJS router and checks access, input and replies around your controllers. You write the controllers and the [hooks](node-hooks.md). AdonisJS 7 is supported, and 6 still works; see [Supported versions](../supported-versions.md).

## Set up

You need:

- Node.js 24 or later;
- a contract in `contract/`, as in [Your first API](../getting-started/your-first-api.md);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Create the app with the AdonisJS API starter, and answer the prompts with the defaults.

```sh
npm init adonisjs@latest notes-app -- --kit=api --pkg=npm
cd notes-app
```

Install seampact.

```sh
npm install @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-adonis
```

The generated code does not compile with the starter's `lib` and unused-variable checks. Replace `tsconfig.json`.

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

The starter already depends on `@vinejs/vine`, which the generated server validates with. There is no validators target. Create `seampact.config.yaml`.

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

With no `validators` entry, the request is checked with [VineJS](../types-and-validation/vinejs.md); [zod](../types-and-validation/zod.md) and [yup](../types-and-validation/yup.md) also work. The types come from [TypeScript types](../types-and-validation/typescript-types.md): see [Types and validation](../types-and-validation/README.md).

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The routes come from `server/notes`.

### What changes for AdonisJS 6

Nothing in this page: the same generated code and the same files run on AdonisJS 6. Only the starter you create differs.

AdonisJS 6 works, but AdonisJS no longer ships security fixes for it: move to AdonisJS 7. See [Supported versions](../supported-versions.md) for how long it stays supported.

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

## Write the hooks

Authenticate, decide, scope resolver, idempotency store and unexpected-error listener are the same on every Node server. [Hooks for Node servers](node-hooks.md) shows each one and a complete `src/notes-hooks.ts`. Pass the object as `hooks`, as in `start/routes.ts` above.

### Use AdonisJS's own auth

Call `@adonisjs/auth` or Bouncer from a decide hook and let it throw: `E_UNAUTHORIZED_ACCESS` (401) and `E_AUTHORIZATION_FAILURE` (403) become the right's first declared denial code. See [Use your framework's own auth](node-hooks.md#use-your-frameworks-own-auth).

## Options

Set these in `options:` of the `server` entry.

| Option | Default | What it does |
|---|---|---|
| `responses` | `strict` | What happens when a handler answers something the contract does not declare. `strict` replaces the reply with the api's 500. `warn` lets it through and logs it. |
| `bodyValidation` | `false` | Check the success bodies your code writes outside the handler result. A handler result is typed already. |
| `frameworkEtag` | `strip` | `strip` removes an ETag AdonisJS adds to a reply written outside the contract. `keep` leaves it. |
| `catchAll` | `true` | Answer the api's 404 for a path under its base path that no route serves, or a method it does not serve. `false` leaves those requests to your app. |
| `rules` | `native` | The checks of the generated VineJS validators. `native` uses VineJS's own rules. `seampact-consistent` gives the contract's exact checks; see [VineJS](../types-and-validation/vinejs.md#native-or-consistent-rules). |

Every option of this target is in the [config reference](../configuration/reference.md#codegen-adonis). Entry keys shared by the Node servers: [`mount`](../configuration/reference.md#mount), [`frameworkRoutes`](../configuration/reference.md#framework-routes) and the [boot check](../configuration/reference.md#boot-check).

`registerRoutes(router, { controllers, hooks, logger })` takes `logger: { warn, error }`. seampact then writes its messages there instead of `console`. The logger is shared by the whole generated api, so the last registration wins.

## Add your own rules

Some rules the contract cannot say: "the end comes after the start", or a check that reads your data. Write them with VineJS, as a rule from `vine.createRule` that reports with its name, and pass the compiled schema as `inputRules` in `registerRoutes`, keyed by operation id, then by part (`path`, `query`, `headers` or `body`). The generated VineJS validators cannot be extended, so write the part's schema yourself. With zod or yup validators, pass a schema of that library instead.

```ts
import vine from '@vinejs/vine'

const endAfterStart = vine.createRule((end, _options, field) => {
  if (typeof end === 'string' && end <= field.parent.start) {
    field.report('The end must come after the start.', 'endAfterStart', field)
  }
})

const scheduleBody = vine.create(
  vine.object({ start: vine.string(), end: vine.string().use(endAfterStart()) }),
)

NotesAdonis.registerRoutes(router, {
  controllers: { NotesEndpoints: () => import('#controllers/notes_controller') },
  hooks: notesHooks(),
  inputRules: { scheduleNote: { body: scheduleBody } },
})
```

- A rule runs after every contract check, the access checks and the idempotency claim, just before the handler. A caller refused with 401 or 403 never reaches it.
- A refusal answers the operation's `schemaInvalid` code (400 by default) with `issues: [{ pointer, rule: "app.<name>" }]`. The name is the one the rule reports. A rule that reports an empty name gives `app.invalid`, and seampact logs the fix once.
- A rule on the whole object (`vine.object(...).use(rule())`) points at the body itself.
- The rule gets a copy of the part, as the handler receives it. It can only refuse: its result and its changes are not used.
- A rule that throws answers 500 and is logged. Its message is never sent.
- A refused request releases its idempotency key, so a corrected retry with the same key is checked again.
- `inputRules` is typed: a misspelt operation, a wrong part or another library's schema does not compile. VineJS's optional members do not compile under `exactOptionalPropertyTypes`, so turn that flag off. At boot, `registerRoutes` also refuses an unknown operation or a part the operation takes no input in.
- A uniqueness check ("this email is already used") stays in the handler, as a declared 409: a check before the write races.

## Rate limits

A 429 from `@adonisjs/limiter` works as is. If the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the `Retry-After` header (seconds or an HTTP date). Without a usable header, the client gets a logged 500: answer the code from the controller with its params instead.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](../contract/05-lists.md).

## Test your routes

Send requests with Japa's API client (`@japa/api-client`). Send the credential your authenticate hook reads.

```ts
const reply = await client.get(`/v1/notes/${noteId}`).header('authorization', 'Bearer test-user')
```

`registerRoutes` runs once when the app starts. To use test hooks, have `notesHooks()` return them when `app.inTest` is true (`import app from '@adonisjs/core/services/app'`).

To test a controller method without HTTP, call it with a plain input. Add `principal` and `scopes` yourself: nothing checks them on a direct call.

```ts
const reply = await new NotesController().getNote({ path: { noteId }, principal: { userId } })
```

### Debug locally

With `NODE_ENV=development` (the starter's `.env` sets it), an exception your controller throws goes to your exception handler, which shows AdonisJS's error page. seampact logs its message and the file and line it came from. Otherwise, under `responses: strict` the client gets the api's 500. Under `responses: warn` the framework's reply goes out as written and the violation is logged.

## Deploy

AdonisJS listens on port 3333. To use 3000, set `PORT=3000` in `.env`.

Behind a proxy, trust only your proxy's addresses in `config/app.ts`, so `request.ip()` is the caller's. Your hooks get `request.ip()` as the client address. AdonisJS 6 trusts loopback proxies by default.

```ts
export const http = defineConfig({
  trustProxy: proxyAddr.compile(['10.0.0.0/8']),
})
```

The proxy forwards the contract's paths as they are (`/v1/notes`). Strip only a prefix you added in front, such as `/api`. To serve the api under a prefix, set `mount: /api` on the target entry instead of a `router.group()` prefix.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix.

In Docker, keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files. `start/env.ts` checks your variables when the app boots.

The server also checks itself at start. Fix the lines it prints, then start again ([all messages](../troubleshooting/boot.md#node-servers)).

| Fault | Fix |
|---|---|
| a hook is missing (`no authenticate hook ...`, `no decider ...`) | Add it. See the [boot check of the hooks](node-hooks.md#boot-check). |
| `the framework route 'GET /docs' is outside the contract and not allow-listed` | List the route under `frameworkRoutes` of the target entry, with a reason, then generate again. |
| `... a route group's prefix differs from the entry's mount` | Call `registerRoutes` outside the group and use `mount` on the entry. |
| a route that takes a body answers 500 | Register `@adonisjs/core/bodyparser_middleware` as router middleware and list `application/json` in `json.types` of the body parser config. |

## Limits

- A query list in the `brackets` form is refused by `generate`.
- An identity header written on a response is refused (`identity.response.header.unsupported`).
- A sort key or a nested input field restricted by a right is refused (`paging.sortKey.restricted.unsupported`, `fieldRight.nestedPointer.unsupported`).
- On AdonisJS 6, a compressed request body (gzip, deflate, br) answers 415, or 413 when it is over the route limit once inflated. Send it uncompressed, or use AdonisJS 7.

Every refusal and its fix: [Node servers](../troubleshooting/generate.md#node-servers) and [every server](../troubleshooting/generate.md#every-server). For 428 and 412 on versioned writes, see [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

## Next

- [Hooks for Node servers](node-hooks.md): write the hooks your contract asks for.
- [Call it from React](../frontend/react.md): use the same contract from the browser.

# Express

`@seampact/codegen-express` generates an Express router that checks access, input and replies for every route of the contract. You write the handlers and the [hooks](node-hooks.md). Express 4 (4.22 or later) and 5 are supported; see [Supported versions](../supported-versions.md).

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](../getting-started/your-first-api.md);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install Express and seampact.

```sh
npm install express@5 zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @types/express@5 @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-express
```

For Express 4, install `express@4` and `@types/express@4` instead. The generated code and your handlers are the same.

In `seampact.config.yaml`, add the targets.

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
    use: "@seampact/codegen-express"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The handlers interface and the router come from `server/notes`.

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesExpress from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesHandlers: NotesExpress.NotesEndpoints = {
  listNotes(input) {
    return { status: Notes.Status.Ok, body: { items: [...notes.values()] } };
  },

  getNote(input) {
    const note = notes.get(input.path.noteId);

    if (note === undefined)
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.Ok, body: note };
  },

  createNote(input) {
    const note = { noteId: randomUUID(), createdAt: new Date().toISOString(), ...input.body };

    notes.set(note.noteId, note);

    return { status: Notes.Status.Created, body: note };
  },

  deleteNote(input) {
    if (!notes.delete(input.path.noteId))
      return { status: Notes.Status.NotFound, code: Notes.ErrorCode.ApiNotFound };

    return { status: Notes.Status.NoContent };
  },
};
```

### Who is calling

When an operation has an identity, its `input` also has `principal`: what your authenticate hook returned. When it runs in a scope, `input.scopes` has one entry per scope, as your resolver returned it (the scope's `value` is `unknown`: narrow it). Both are read-only and are left out when you spread or serialise `input`. Type the parameter with `HandlerInputs`.

```ts
getNote(input: NotesExpress.HandlerInputs["getNote"]) {
  const ownerId = input.principal.userId;
  const workspaceId = input.scopes.workspace.id;
```

A public operation has no `principal`, and an operation in no scope has no `scopes`.

## Wire it in

Create `src/main.ts`. Mount the router at the root of the app, without a path: the contract paths already start with `/v1`.

```ts
import express from "express";
import * as NotesExpress from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = express();

app.use(NotesExpress.router({ handlers: { NotesEndpoints: notesHandlers }, hooks: notesHooks() }));
app.use(NotesExpress.preRoutingErrorHandler);

NotesExpress.checkFrameworkRoutes(app);

app.listen(3000);
```

- `router` parses JSON itself, so bad JSON and unknown routes answer in the contract's error format. For a public api, leave `hooks` out.
- `preRoutingErrorHandler` does the same for errors raised by middleware you mount before the router, such as `express.json()` or a rate limiter. A JSON parser you mount before the router needs `verify: NotesExpress.keepRawBody` and `limit: NotesExpress.LARGEST_BODY_LIMIT`.
- `checkFrameworkRoutes` checks the routes you add outside the contract. Express has no start hook: call it once every route is mounted, before `listen`. It throws and names the route it refuses.

Check the types.

```sh
npx tsc -p .
```

You see no output.

## Write the hooks

Authenticate, decide, scope resolver, idempotency store and unexpected-error listener are the same on every Node server. [Hooks for Node servers](node-hooks.md) shows each one and a complete `src/notes-hooks.ts`. Pass the object as `hooks`, as in `main.ts` above.

### Use Express's own auth

Call your auth library from a decide hook and let it throw an error whose `status` is 401 or 403: seampact answers the right's first declared denial code. See [Use your framework's own auth](node-hooks.md#use-your-frameworks-own-auth).

## Options

Set these in `options:` of the `server` entry.

| Option | Default | What it does |
|---|---|---|
| `responses` | `strict` | What happens when a handler answers something the contract does not declare. `strict` replaces the reply with the api's 500. `warn` lets it through and logs it. |
| `bodyValidation` | `false` | Check the success bodies your code writes outside the handler result. Needs the validators target. A handler result is typed already. |
| `frameworkEtag` | `strip` | `strip` removes an ETag Express adds to a reply written outside the contract. `keep` leaves it. |
| `catchAll` | `true` | Answer the api's 404 for a path under its base path that no route serves, or a method it does not serve. `false` leaves those requests to your app. |

Every option of this target is in the [config reference](../configuration/reference.md#codegen-express). Entry keys shared by the Node servers: [`mount`](../configuration/reference.md#mount), [`frameworkRoutes`](../configuration/reference.md#framework-routes) and the [boot check](../configuration/reference.md#boot-check).

`router({ handlers, hooks, logger })` takes `logger: { warn, error }`. seampact then writes its messages there instead of `console`. The logger is shared by the whole generated api, so the last registration wins.

## Rate limits

A 429 from `express-rate-limit` works as is. If the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the `Retry-After` header (seconds or an HTTP date). Without a usable header, the client gets a logged 500: answer the code from the handler with its params instead.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](../contract/05-lists.md).

## Test your routes

Build the app as `main.ts` does, without `listen`, and send requests with `supertest`. Send the credential your authenticate hook reads.

```ts
const reply = await request(app).get(`/v1/notes/${noteId}`).set("authorization", "Bearer test-user");
```

To replace the hooks in a test, pass test hooks to the router: `router({ handlers, hooks: testHooks })`.

To test a handler without HTTP, call it with a plain input. Add `principal` and `scopes` yourself: nothing checks them on a direct call.

```ts
const reply = await notesHandlers.getNote({ path: { noteId }, principal: { userId } });
```

### Debug locally

With `NODE_ENV=development`, an exception your handler throws goes to Express's error handler, which shows its stack. seampact logs its message and the file and line it came from. Otherwise, under `responses: strict` the client gets the api's 500. Under `responses: warn` Express's reply goes out as written and the violation is logged.

## Deploy

Behind a proxy, trust only your proxy's addresses, never `true`, so `req.ip` and `req.protocol` are the caller's. Your hooks get `req.ip` as the client address.

```ts
app.set("trust proxy", ["loopback", "10.0.0.0/8"]);
```

The proxy forwards the contract's paths as they are (`/v1/notes`). Strip only a prefix you added in front, such as `/api`. To serve the api under a prefix, set `mount: /api` on the target entry instead, and mount the router at the root: under a path it answers 500 and logs why.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix.

In Docker, keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files. Check your variables once at start with your validator, and stop when one is missing.

The server also checks itself at start. Fix the lines it prints, then start again ([all messages](../troubleshooting/boot.md#node-servers)).

| Fault | Fix |
|---|---|
| a hook is missing (`no authenticate hook ...`, `no decider ...`) | Add it. See the [boot check of the hooks](node-hooks.md#boot-check). |
| `the framework route 'GET /docs' is outside the contract and not allow-listed` | List the route under `frameworkRoutes` of the target entry, with a reason, then generate again. |
| `the router of api 'notes' is mounted under '<path>'` | Mount the router at the root of the app and use `mount` on the entry. |
| `handlers.NotesEndpoints has no method getNote()` | Implement the method. |

## Limits

- A query list in the `brackets` form is refused by `generate`.
- An identity header written on a response is refused (`identity.response.header.unsupported`).
- A sort key or a nested input field restricted by a right is refused (`paging.sortKey.restricted.unsupported`, `fieldRight.nestedPointer.unsupported`).

Every refusal and its fix: [Node servers](../troubleshooting/generate.md#node-servers) and [every server](../troubleshooting/generate.md#every-server). For 428 and 412 on versioned writes, see [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

## Next

- [Hooks for Node servers](node-hooks.md): write the hooks your contract asks for.
- [Call it from React](../frontend/react.md): use the same contract from the browser.

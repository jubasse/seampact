# Hono

`@seampact/codegen-hono` generates the routes of the contract on a Hono app and checks access, input and replies around your handlers. You write the handlers and the [hooks](node-hooks.md). Hono 4 on Node.js is supported; see [Supported versions](../supported-versions.md).

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](../getting-started/your-first-api.md);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install Hono and seampact. You do not need `experimentalDecorators`.

```sh
npm install hono @hono/node-server zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-hono
```

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
    use: "@seampact/codegen-hono"
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

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The handlers interface and `registerRoutes` come from `server/notes`.

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesHono from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesEndpoints: NotesHono.NotesEndpoints = {
  listNotes() {
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
getNote(input: NotesHono.HandlerInputs["getNote"]) {
  const ownerId = input.principal.userId;
  const workspaceId = input.scopes.workspace.id;
```

A public operation has no `principal`, and an operation in no scope has no `scopes`.

## Wire it in

Create `src/main.ts`.

```ts
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import * as NotesHono from "./__generated__/server/notes/index.js";
import { notesEndpoints } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = new Hono();

app.onError((error, c) => NotesHono.renderContractError(c, error));

NotesHono.registerRoutes(app, {
  handlers: { NotesEndpoints: notesEndpoints },
  hooks: notesHooks(),
  clientAddress: (c) => getConnInfo(c).remote.address,
});

NotesHono.checkFrameworkRoutes(app);

serve({ fetch: app.fetch, port: 3000 });
```

- `onError` makes a failing handler answer in the contract's error format.
- `clientAddress` gives your hooks the caller's address. Without it, they get none.
- Call `registerRoutes` on an app without `basePath()`. A base path is refused at boot.
- `checkFrameworkRoutes` must run after the last route is added and before the app serves.
- For a public api, leave `hooks` out.

If your own middleware answers 401, 403 or 429 on a contract route, render it in the contract's format with `renderPreRoutingError`:

```ts
app.onError(async (error, c) => (await NotesHono.renderPreRoutingError(c, error)) ?? NotesHono.renderContractError(c, error));
```

Check the types.

```sh
npx tsc -p .
```

You see no output.

## Write the hooks

Authenticate, decide, scope resolver, idempotency store and unexpected-error listener are the same on every Node server. [Hooks for Node servers](node-hooks.md) shows each one and a complete `src/notes-hooks.ts`. Pass the object as `hooks`, as in `main.ts` above.

### Use Hono's own auth

Call your auth logic from a decide hook and let it throw a Hono `HTTPException` with status 401 or 403: seampact answers the right's first declared denial code. See [Use your framework's own auth](node-hooks.md#use-your-frameworks-own-auth).

## Options

Set these in `options:` of the `server` entry.

| Option | Default | What it does |
|---|---|---|
| `responses` | `strict` | What happens when a handler answers something the contract does not declare. `strict` replaces the reply with the api's 500. `warn` lets it through and logs it. |
| `bodyValidation` | `false` | Check the success bodies your code writes outside the handler result. Needs the validators target. A handler result is typed already. |
| `frameworkEtag` | `strip` | `strip` removes an ETag Hono adds to a reply written outside the contract. `keep` leaves it. |
| `catchAll` | `true` | Answer the api's 404 for a path under its base path that no route serves, or a method it does not serve. `false` leaves those requests to your app. |

Every option of this target is in the [config reference](../configuration/reference.md#codegen-hono). Entry keys shared by the Node servers: [`mount`](../configuration/reference.md#mount), [`frameworkRoutes`](../configuration/reference.md#framework-routes) and the [boot check](../configuration/reference.md#boot-check).

`registerRoutes(app, { handlers, hooks, clientAddress, logger })` takes `logger: { warn, error }`. seampact then writes its messages there instead of `console`. The logger is shared by the whole generated api, so the last registration wins.

## Rate limits

A 429 from `hono-rate-limiter` works as is. If the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the `Retry-After` header (seconds or an HTTP date). Without a usable header, the client gets a logged 500: answer the code from the handler with its params instead.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](../contract/05-lists.md).

## Test your routes

Build the app as `main.ts` does, without `serve`, and send requests with `app.request`. Send the credential your authenticate hook reads.

```ts
const reply = await app.request(`/v1/notes/${noteId}`, { headers: { authorization: "Bearer test-user" } });
```

To replace the hooks in a test, pass test hooks to `registerRoutes`: `registerRoutes(app, { handlers, hooks: testHooks })`.

To test a handler without HTTP, call it with a plain input. Add `principal` and `scopes` yourself: nothing checks them on a direct call.

```ts
const reply = await notesEndpoints.getNote({ path: { noteId }, principal: { userId } });
```

### Debug locally

An exception your handler throws reaches your `onError`. With the `onError` of `main.ts`, the client gets the api's 500 and seampact logs the exception. With `NODE_ENV=development`, `renderContractError` leaves the exception to Hono instead: seampact logs its message and the file and line it came from, and Hono answers its plain 500. To show your own reply while you develop, return it from `onError` before the call.

## Deploy

Hono has no trust-proxy setting. Behind a proxy, `getConnInfo` gives the proxy's address. In `clientAddress`, read the last `X-Forwarded-For` entry instead, and only when the request comes from your proxy. Your hooks get the address it returns.

The proxy forwards the contract's paths as they are (`/v1/notes`). Strip only a prefix you added in front, such as `/api`. To serve the api under a prefix, set `mount: /api` on the target entry instead of `basePath()`.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix.

In Docker, keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files. Check your variables once at start with your validator, and stop when one is missing.

The server also checks itself at start. Fix the lines it prints, then start again ([all messages](../troubleshooting/boot.md#node-servers)).

| Fault | Fix |
|---|---|
| a hook is missing (`no authenticate hook ...`, `no decider ...`) | Add it. See the [boot check of the hooks](node-hooks.md#boot-check). |
| `the framework route 'GET /docs' is outside the contract and not allow-listed` | List the route under `frameworkRoutes` of the target entry, with a reason, then generate again. |
| `the app has the base path '<path>', which differs from the entry's mount` | Call `registerRoutes` on an app without `basePath()` and use `mount` on the entry. |
| `'clientAddress' is not a function` | Pass a function that returns the address. |
| `handlers.NotesEndpoints has no method getNote()` | Implement the method. |

## Limits

- A query list in the `brackets` form is refused by `generate`.
- An identity header written on a response is refused (`identity.response.header.unsupported`).
- A sort key or a nested input field restricted by a right is refused (`paging.sortKey.restricted.unsupported`, `fieldRight.nestedPointer.unsupported`).

Every refusal and its fix: [Node servers](../troubleshooting/generate.md#node-servers) and [every server](../troubleshooting/generate.md#every-server). For 428 and 412 on versioned writes, see [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

## Next

- [Hooks for Node servers](node-hooks.md): write the hooks your contract asks for.
- [Call it from React](../frontend/react.md): use the same contract from the browser.

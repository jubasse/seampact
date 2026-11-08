# Fastify

`@seampact/codegen-fastify` generates a Fastify plugin that checks access, input and replies for every route of the contract. You write the handlers and the [hooks](node-hooks.md). Fastify 5 is supported; see [Supported versions](../supported-versions.md).

## Set up

You need:

- Node.js 24 or later;
- a contract, as in [Your first API](../getting-started/your-first-api.md);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install Fastify and seampact. The Fastify target checks bodies with Ajv validators it generates, so there is no `zod` and no validators target.

```sh
npm install fastify ajv @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-fastify
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
  - id: server
    use: "@seampact/codegen-fastify"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
```

With no `validators` entry, the request is checked with [Ajv](../types-and-validation/ajv.md); [zod](../types-and-validation/zod.md) and [yup](../types-and-validation/yup.md) also work. The types come from [TypeScript types](../types-and-validation/typescript-types.md): see [Types and validation](../types-and-validation/README.md).

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

You see one line per target, and the files appear in `src/__generated__`. Types come from `types/notes`. The handlers interface and the plugin come from `server/notes`. Fastify has no decorators: leave `experimentalDecorators` out of `tsconfig.json`.

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes: `ApiNotFound` is the built-in `api.not_found`. Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesFastify from "./__generated__/server/notes/index.js";
import * as Notes from "./__generated__/types/notes/index.js";

const notes = new Map<string, Notes.schemas.Note>();

export const notesHandlers: NotesFastify.NotesEndpoints = {
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
getNote(input: NotesFastify.HandlerInputs["getNote"]) {
  const ownerId = input.principal.userId;
  const workspaceId = input.scopes.workspace.id;
```

A public operation has no `principal`, and an operation in no scope has no `scopes`.

## Wire it in

Create `src/main.ts`.

```ts
import Fastify from "fastify";
import * as NotesFastify from "./__generated__/server/notes/index.js";
import { notesHandlers } from "./notes-handlers.js";
import { notesHooks } from "./notes-hooks.js";

const app = Fastify();

NotesFastify.collectFrameworkRoutes(app);

await app.register(NotesFastify.plugin, {
  handlers: { NotesEndpoints: notesHandlers },
  hooks: notesHooks(),
});

app.setNotFoundHandler((request, reply) => {
  if (NotesFastify.renderPreRoutingError(request, reply)) return;

  reply.code(404).send({ message: "not found" });
});

await app.listen({ port: 3000 });
```

- `collectFrameworkRoutes` must come right after `Fastify()`. The plugin uses it at start to find the routes you add outside the contract.
- Register the plugin without a prefix. Another prefix is refused at boot.
- The not-found handler answers unknown routes in the contract's error format.
- For a public api, leave `hooks` out.

Check the types.

```sh
npx tsc -p .
```

You see no output.

## Write the hooks

Authenticate, decide, scope resolver, idempotency store and unexpected-error listener are the same on every Node server. [Hooks for Node servers](node-hooks.md) shows each one and a complete `src/notes-hooks.ts`. Pass the object as `hooks`, as in `main.ts` above.

### Use Fastify's own auth

Call your auth library from a decide hook and let it throw an error whose `statusCode` is 401 or 403 (`@fastify/sensible`'s `httpErrors.unauthorized()` does): seampact answers the right's first declared denial code. See [Use your framework's own auth](node-hooks.md#use-your-frameworks-own-auth).

## Options

Set these in `options:` of the `server` entry.

| Option | Default | What it does |
|---|---|---|
| `responses` | `strict` | What happens when a handler answers something the contract does not declare. `strict` replaces the reply with the api's 500. `warn` lets it through and logs it. |
| `bodyValidation` | `false` | Check the success bodies your code writes outside the handler result. A handler result is typed already. |
| `frameworkEtag` | `strip` | `strip` removes an ETag Fastify adds to a reply written outside the contract. `keep` leaves it. |
| `catchAll` | `true` | Answer the api's 404 for a path under its base path that no route serves, or a method it does not serve. `false` leaves those requests to your app. |
| `compression` | `{ thresholdBytes: 1024 }` | When `@fastify/compress` is registered, compress replies of at least this size. `off` never compresses. `{ thresholdBytes: 4096 }` moves the threshold. |

Every option of this target is in the [config reference](../configuration/reference.md#codegen-fastify). Entry keys shared by the Node servers: [`mount`](../configuration/reference.md#mount), [`frameworkRoutes`](../configuration/reference.md#framework-routes) and the [boot check](../configuration/reference.md#boot-check).

`register(plugin, { handlers, hooks, logger })` takes `logger: { warn, error }`. seampact then writes its messages there instead of `console`. The logger is shared by the whole generated api, so the last registration wins.

## Add your own rules

Some rules the contract cannot say: "the end comes after the start", or a check that reads your data. Write them in the validator library your api's validators use (zod `params.rule`, yup `.test({ name })`, or an Ajv keyword when the target writes its own Ajv validators), and pass them as `inputRules` beside `hooks`, keyed by operation id, then by part (`path`, `query`, `headers` or `body`).

```ts
import { z } from "zod";

const scheduleBody = z
  .object({ start: z.string(), end: z.string() })
  .refine((body) => body.end > body.start, { path: ["end"], params: { rule: "endAfterStart" } });

await app.register(NotesFastify.plugin, {
  handlers: { NotesEndpoints: notesHandlers },
  hooks: notesHooks(),
  inputRules: { scheduleNote: { body: scheduleBody } },
});
```

- A rule runs after every contract check, the access checks and the idempotency claim, just before the handler. A caller refused with 401 or 403 never reaches it.
- A refusal answers the operation's `schemaInvalid` code (400 by default) with `issues: [{ pointer, rule: "app.<name>" }]`. A rule without a usable name gives `app.invalid`, and seampact logs the fix once.
- The rule gets a copy of the part, as the handler receives it. It can only refuse: its result and its changes are not used.
- A rule that throws answers 500 and is logged. Its message is never sent.
- A refused request releases its idempotency key, so a corrected retry with the same key is checked again.
- `inputRules` is typed: a misspelt operation, a wrong part or another library's schema does not compile. At boot, `the plugin` also refuses an unknown operation or a part the operation takes no input in.
- A uniqueness check ("this email is already used") stays in the handler, as a declared 409: a check before the write races.

## Rate limits

A 429 from `@fastify/rate-limit` works as is. If the operation's `rateLimited` code requires `retryAfterMs`, seampact fills it from the `Retry-After` header (seconds or an HTTP date). Without a usable header, the client gets a logged 500: answer the code from the handler with its params instead.

## Paging

A list handler returns the items and the page facts your paging style names, for example `{ items, nextCursor }`. Read the client's cursor in `input.query.cursor`. See [Lists](../contract/05-lists.md).

## Docs and OpenAPI

To show the contract in `@fastify/swagger`, set `artefacts: { nativeDocs: true }` on the `server` entry and generate again. Register `@fastify/swagger` in OpenAPI 3.1 mode, with the generated transform. Do this before the plugin.

```ts
await app.register(swagger, {
  openapi: { openapi: "3.1.0", info: { title: "Notes", version: "1" } },
  transformObject: NotesFastify.contractSwaggerTransformObject(),
});
```

With two apis, pass the first transform to the second: `OtherFastify.contractSwaggerTransformObject(NotesFastify.contractSwaggerTransformObject())`. If the Swagger UI adds routes such as `/docs`, list them under `frameworkRoutes`. More in [OpenAPI and docs](../configuration/openapi-and-docs.md).

## Test your routes

Build the app as `main.ts` does, without `listen`, and send requests with `app.inject`. Send the credential your authenticate hook reads.

```ts
const reply = await app.inject({
  method: "GET",
  url: `/v1/notes/${noteId}`,
  headers: { authorization: "Bearer test-user" },
});
```

To replace the hooks in a test, pass test hooks to the plugin: `app.register(NotesFastify.plugin, { handlers, hooks: testHooks })`.

To test a handler without HTTP, call it with a plain input. Add `principal` and `scopes` yourself: nothing checks them on a direct call.

```ts
const reply = await notesHandlers.getNote({ path: { noteId }, principal: { userId } });
```

### Debug locally

With `NODE_ENV=development`, an exception your handler throws goes to Fastify's error handler, which answers its message. seampact logs the message and the file and line it came from. Otherwise, under `responses: strict` the client gets the api's 500. Under `responses: warn` Fastify's reply goes out as written and the violation is logged.

## Deploy

Behind a proxy, trust only your proxy's addresses, not a hop count, so `request.ip` and `request.protocol` are the caller's. Your hooks get `request.ip` as the client address.

```ts
const app = Fastify({ trustProxy: ["127.0.0.1", "10.0.0.0/8"] });
```

The proxy forwards the contract's paths as they are (`/v1/notes`). Strip only a prefix you added in front, such as `/api`. To serve the api under a prefix, set `mount: /api` on the target entry instead, and register the plugin without a prefix.

Page links are query-only (`?page=2`), so they stay right behind a proxy that strips a prefix.

In Docker, keep `.env` out of the image: add it to `.dockerignore`, and pass values with `docker run -e` or mounted secret files. Check your variables at start with `@fastify/env`; they are ready after `await app.register(...)`.

The server also checks itself at start. Fix the lines it prints, then start again ([all messages](../troubleshooting/boot.md#node-servers)).

| Fault | Fix |
|---|---|
| a hook is missing (`no authenticate hook ...`, `no decider ...`) | Add it. See the [boot check of the hooks](node-hooks.md#boot-check). |
| `the framework route 'GET /docs' is outside the contract and not allow-listed` | List the route under `frameworkRoutes` of the target entry, with a reason, then generate again. |
| `the plugin is registered under the prefix '<prefix>', which is not one of the api's base paths` | Register the plugin without a prefix and use `mount` on the entry. |
| `handlers.NotesEndpoints has no method getNote()` | Implement the method. |

## Limits

- A query list in the `brackets` form is refused by `generate`.
- An identity header written on a response is refused (`identity.response.header.unsupported`).
- A sort key or a nested input field restricted by a right is refused (`paging.sortKey.restricted.unsupported`, `fieldRight.nestedPointer.unsupported`).

Every refusal and its fix: [Node servers](../troubleshooting/generate.md#node-servers) and [every server](../troubleshooting/generate.md#every-server). For 428 and 412 on versioned writes, see [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

## Next

- [Hooks for Node servers](node-hooks.md): write the hooks your contract asks for.
- [Call it from React](../frontend/react.md): use the same contract from the browser.

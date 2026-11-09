# Next.js

`@seampact/codegen-nextjs` generates a route handler per api. You put it in one catch-all route file, and it serves every route of the contract: it checks access, input and replies around your handlers. You write the handlers and the [hooks](node-hooks.md). Next.js 16 on the Node.js runtime is supported; see [Supported versions](../supported-versions.md).

## Set up

You need:

- Node.js 24 or later;
- a Next.js 16 app with the App Router;
- a contract, as in [Your first API](../getting-started/your-first-api.md);
- every `@seampact/*` package at the same version. Yarn Plug'n'Play is not supported.

Install seampact.

```sh
npm install zod @seampact/server-runtime @seampact/hooks
npm install --save-dev @seampact/cli @seampact/codegen-ts @seampact/codegen-zod @seampact/codegen-nextjs
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
    use: "@seampact/codegen-nextjs"
    apis: [notes]
    options:
      bodyValidation: true
    link:
      types: types
      validators: validators
```

The request is checked with [zod](../types-and-validation/zod.md), and the types come from [TypeScript types](../types-and-validation/typescript-types.md).

Generate, then commit the files: `seampact check` fails later if they drift from the contract.

```sh
npx seampact generate
```

The files appear in `src/__generated__`. Their imports have no `.js` extension, as Next.js expects. Types come from `types/notes`. The handlers interface and `routeHandler` come from `server/notes`.

In `next.config.ts`, turn off the trailing-slash redirect, so the contract answers those paths itself.

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
```

This setting applies to the whole app: your own pages lose their trailing-slash redirect too. Without it, Next.js redirects `/v1/notes/7/` to `/v1/notes/7` and serves it, where the contract answers 404.

## Write a handler

The generated `NotesEndpoints` interface has one method per operation. Each returns a status and the body the contract allows for it. `Notes.Status` names the statuses, and `Notes.ErrorCode` the error codes. Create `src/notes-handlers.ts`.

```ts
import { randomUUID } from "node:crypto";
import type * as NotesNext from "./__generated__/server/notes";
import * as Notes from "./__generated__/types/notes";

const notes = new Map<string, Notes.schemas.Note>();

export const notesEndpoints: NotesNext.NotesEndpoints = {
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

When an operation has an identity, its `input` also has `principal`, and when it runs in a scope, `input.scopes`. See [Who is calling](hono.md#who-is-calling): it works the same way.

## Wire it in

Build the route handler's options once, in `src/notes-route.ts`.

```ts
import { notesEndpoints } from "./notes-handlers";
import { notesHooks } from "./notes-hooks";

export const notesRouteOptions = {
  handlers: { NotesEndpoints: notesEndpoints },
  hooks: notesHooks(),
  clientAddress: (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0],
};
```

Then create the catch-all route file under the api's base path, `src/app/v1/[[...path]]/route.ts`.

```ts
import { routeHandler } from "@/__generated__/server/notes";
import { notesRouteOptions } from "@/notes-route";

export const runtime = "nodejs";

const handler = routeHandler(notesRouteOptions);

export { handler as DELETE, handler as GET, handler as HEAD, handler as OPTIONS, handler as PATCH, handler as POST, handler as PUT };
```

- Export the handler under every method name. A method the contract does not serve then answers the contract's 404, not Next.js's 405.
- `runtime = "nodejs"` is required. On the Edge runtime the route fails to load. If your app sets `cacheComponents: true`, remove this line: Next.js refuses it there, and the route runs on Node.js.
- An api with several base paths needs one route file per base path, each importing the same options.
- For a public api, leave `hooks` out.
- `clientAddress` gives your hooks the caller's address. Without it, they get none.

Check the types.

```sh
npx tsc -p .
```

You see no output.

## Write the hooks

Authenticate, decide, scope resolver, idempotency store and unexpected-error listener are the same on every Node server. [Hooks for Node servers](node-hooks.md) shows each one and a complete `src/notes-hooks.ts`.

A module-level store, such as an idempotency store, is shared by the route files of one server process. On several instances or a serverless host, use an external store.

## Options

Set these in `options:` of the `server` entry.

| Option | Default | What it does |
|---|---|---|
| `responses` | `strict` | What happens when a handler answers something the contract does not declare. `strict` replaces the reply with the api's 500. `warn` lets it through and logs it. |
| `bodyValidation` | `false` | Check the success bodies your code writes outside the handler result. Needs the validators target. |
| `frameworkEtag` | `strip` | `strip` removes an ETag added to a reply written outside the contract. `keep` leaves it. |
| `catchAll` | `true` | Must stay `true`: the catch-all route file is the api's only route. |

`routeHandler` also takes `inputRules` and `logger: { warn, error }`, as on Hono. See [Add your own rules](hono.md#add-your-own-rules).

Every option of this target is in the [config reference](../configuration/reference.md#codegen-nextjs). The entry key [`mount`](../configuration/reference.md#mount) is shared by the Node servers.

## Errors from your own code

An exception your handler throws answers the api's 500, and seampact passes it to your unexpected-error hook. No error reaches the Next.js error page.

To answer a contract error from your own Node.js route or your `proxy.ts`, call `renderContractError(request, error)` from the generated module.

## Test your routes

Call the route handler with a `Request`. Send the credential your authenticate hook reads.

```ts
import { GET } from "@/app/v1/[[...path]]/route";

const reply = await GET(new Request(`http://localhost/v1/notes/${noteId}`, { headers: { authorization: "Bearer test-user" } }));
```

To test a handler without HTTP, call it with a plain input. Add `principal` and `scopes` yourself: nothing checks them on a direct call.

## Deploy

The proxy in front of your app forwards the contract's paths as they are (`/v1/notes`). If your app sets a Next.js `basePath`, set the same value as `mount` on the target entry. Otherwise each request answers the api's 500 and the log names the fix.

If your app has a `proxy.ts`, Next.js keeps only the first 10 MB of a request body. Raise `experimental.proxyClientMaxBodySize` in `next.config` above your api's largest body limit. A cut body with a `Content-Length` answers the api's 500 and the log names this setting.

The route handler checks itself when its route file loads. Fix the lines it prints, then start again ([all messages](../troubleshooting/boot.md#node-servers)).

| Fault | Fix |
|---|---|
| a hook is missing (`no authenticate hook ...`, `no decider ...`) | Add it. See the [boot check of the hooks](node-hooks.md#boot-check). |
| `runtime.edge.unsupported` | Export `runtime = "nodejs"` from the route file. |
| `'clientAddress' is not a function` | Pass a function that returns the address. |
| `handlers.NotesEndpoints has no method getNote()` | Implement the method. |

## Limits

- Keep your own route files, pages and rewrites outside the api's base paths. A more specific route file wins over the catch-all, and nothing checks it.
- `generate` refuses `frameworkRoutes` and `artefacts.bootCheck.frameworkRoutes` on this target: no check reads a Next.js app's routes.
- An api needs a base path, and two apis may not share or nest one (`/v1` and `/v1/admin`).
- Next.js answers three requests itself, outside the api's format: a path with `//` (a 308 redirect), a malformed percent-escape such as `%E0%A4%A` (its 500), and a request a more specific route file or a rewrite takes.
- `isContractRoute` and `renderPreRoutingError` of Hono have no Next.js version yet.
- Next.js 15 and older are refused.

Every refusal and its fix: [Node servers](../troubleshooting/generate.md#node-servers) and [every server](../troubleshooting/generate.md#every-server).

## Next

- [Hooks for Node servers](node-hooks.md): write the hooks your contract asks for.
- [Call it from React](../frontend/react.md): use the same contract from the browser.

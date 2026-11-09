# ADR 0030: The Next.js server target

Status: accepted

## Context

ADR 0020 split the shared server runtime by what it imports and gave it a Web profile: the `Request` view, the bounded body read, the reply as a `Response` and the outgoing check on a `Response`, importing no framework, so that a Next.js route handler could call them as the Hono placement does. This ADR fixes the Next.js target on that profile: an App Router route handler that runs the boundary around the developer's handler map. What it does not restate holds as ADR 0016 and ADR 0020 say.

Six Next.js behaviours, seen in the spike below, shape the placement:

- Routing is the file system: `app/<path>/route.ts` exports one function per HTTP method. An optional catch-all `[[...path]]` also serves its bare directory; a plain `[...path]` leaves it to Next's own 404. The more specific file wins.
- The route's `params` is a `Promise` of percent-decoded values: `a%2Fb` gives `a/b`, `%73earch` gives `search`. `request.url` keeps the raw path.
- Next answers some requests before any route: a trailing slash and `//` with a 308 redirect, a malformed percent-escape with its own 500 (400 in development, as HTML), a method the file does not export with 405.
- A route handler has no error hook: a throw becomes Next's own HTML 500.
- A route runs on Node or on the Edge runtime, which Next 16.4 deprecates.
- Turbopack, the default bundler of `next dev` and `next build`, does not resolve a `.js` import specifier to a `.ts` source.

## Options

- Routes: one route file per contract path, or one optional catch-all per base path of the api. Choice: the catch-all. A file per path works only when its path equals the contract path, mount included, needs a sibling file for every static segment beside a placeholder, and gives a tree to generate and keep in sync for nothing `matchContractRoute` does not already do.
- Matching: Next's `params` or the raw path of `request.url`. Choice: the raw path, as on Hono. The decoded `params` cannot tell `a%2Fb` from `a/b`, nor `%73earch` from `search`.
- Runtimes: Node and Edge, or Node only. Choice: Node only, Edge refused by name. Edge is deprecated, and in development it appended the catch-all params to `request.url` as a query, which step 6 refused as unknown keys; its memory stores are per isolate.
- Errors: rethrown to Next, or rendered by the boundary. Choice: the boundary renders every error, since Next has no hook that could render it in the api's format.
- Import specifiers in the generated tree: `.js`, with webpack and an extension alias required of the app; `.ts`; or extensionless. Choice: extensionless. Next projects resolve with `moduleResolution: bundler`, which takes them, and both bundlers resolve them; an app keeps Turbopack.

## Decisions

### Placement

The runtime gains a `/next` export of `@seampact/server-runtime` (`next.ts`), on the Web profile only. It imports nothing from `next`: a route handler takes a `Request` and returns a `Response`. Its `createNextBoundary(api, generated, bindings)` returns a route handler `(request, context) => Promise<Response>` that runs every step, and `renderContractError`.

The steps it shares with Hono (media type, bounded body read, steps 2 to 8, step 8b, the handler call and its reply, the error claim, the outgoing check) move out of `hono.ts` into one Web module both placements call, never a copy; the Hono tests stay green on it.

Codegen emits, per api, the shared `routes.ts`, `handlers.ts` and `hooks.ts`, the linked validators and types, and `next.ts`, re-exported by the api's `index.ts`. Its fixed exports are `routeHandler`, `renderContractError`, `MAX_CHECKED_ERROR_BODY_BYTES` and `MAX_RENDERED_ISSUES`. The app writes one route file per base path of the api:

```ts
// app/v1/[[...path]]/route.ts
import { routeHandler } from "@/server/__generated__/next/tasks/next";
import { hooks, tasksHandlers } from "@/server/tasks";

export const runtime = "nodejs";

const handler = routeHandler({ handlers: { TasksEndpoints: tasksHandlers }, hooks });

export { handler as DELETE, handler as GET, handler as HEAD, handler as OPTIONS, handler as PATCH, handler as POST, handler as PUT };
```

The route file is the app's: codegen writes only under the target entry's `out`, and the file holds the app's own segment config. `dynamic` is not emitted: a route handler that reads the request is dynamic since Next 15, and `dynamic = "force-dynamic"` is a build error under `cacheComponents`. Whether `next build` prerenders the catch-all's `GET` for the bare base path under `cacheComponents` is checked by nextjs-1's live test. The `routeHandler` options are Hono's `registerRoutes` options (ADR 0020 "Options and registration"), `inputRules` included, without the app. An api with several base paths calls `routeHandler` once per route file, each call checked alone; the guide builds one options object in a module of the app and passes it from every route file, so the files of one api share their handlers, hooks and stores.

Hono's `renderPreRoutingError` and `isContractRoute` have no Next counterpart yet: Next has no error hook for a refusal raised before the route, and a `proxy.ts` that denies a request on a contract path answers in its own format unless it calls `renderContractError`. A proxy counterpart waits for an app that needs it.

The app sets `skipTrailingSlashRedirect: true` in its `next.config`, so a trailing slash and the bare base path reach the boundary. The setting is app-wide: the app's own pages lose their trailing-slash redirect too. Without it, Next redirects `/v1/tasks/7/` with a 308 to `/v1/tasks/7`, which is then served, so the contract's 404 for a trailing slash is lost silently; the guide lists both effects.

A published install of the runtime needs no setting, since the package ships JavaScript. A workspace link with `transpilePackages` worked under webpack only, since Turbopack cannot resolve the runtime's `src/` imports; nextjs-1's live test installs the packed runtime tarball, as the consumers do, and runs under Turbopack.

### Routes

The handler never reads `params`. It matches the request's method and the raw path of `new URL(request.url).pathname` against the contract templates with `matchContractRoute`, as on Hono: `/v1/%68ealth` answers the contract 404, a trailing slash and the bare base path answer the api's base-path 404. Every method is exported, so a method the path does not serve answers the path's `notFound` 404 rather than Next's 405, and `HEAD` runs the path's `GET` operation.

The catch-all receives only paths under its own directory. A request whose raw path is under none of the api's mounted base paths, which a Next `basePath` that the entry's `mount` does not state gives on every request, answers the api's 500 with a log naming the fix: set `mount` to the `basePath`, or move the route file. This is the mount-mismatch refusal of ADR 0012, made at the first request as on Express.

Three requests stay Next's, outside the api's format, with no hook to change them; the guide lists them:

- `//` in the path, redirected with a 308 even with `skipTrailingSlashRedirect`, where Hono answers the base-path 404;
- a malformed percent-escape (`/v1/channels/%E0%A4%A`), answered by Next with its own 500, where Hono answers the `schemaInvalid` 400;
- a request that never reaches the catch-all: a more specific app `route.*` or `page.*` file at or under a base path, route groups included, or a `next.config` `rewrites` entry or a proxy rewrite that sends it elsewhere ("The boot check").

### The Node runtime

The target serves the Node runtime only. The guide's route file exports `runtime = "nodejs"`. Under the Edge runtime, which Next marks with the global `EdgeRuntime`, the generated `next.ts` throws `runtime.edge.unsupported` when it loads, with the fix to export `runtime = "nodejs"` from the route file, so the route fails to load rather than serve. Importing the runtime package alone never throws.

Under webpack's `next start`, the spike saw one module instance serve a catch-all and a per-path file, so a module-level idempotency store is shared across an app's route files there; `next dev` and Turbopack were not checked, and nextjs-1's live test checks them. Several instances, a serverless deployment among them, need an external store, as on every target.

### Body, signatures and step 8b

The boundary reads `request.body` with the Web profile's `readContractBody`, unchanged: a declared length over the route's limit answers 413 before reading, a chunked body is counted while reading, and a signed route verifies the raw bytes as sent. Nothing in Next reads the body before a route handler, and Next sets no body limit on route handlers.

An app with a `proxy.ts` (formerly `middleware.ts`) is the exception: Next buffers the body for it and keeps only the first 10 MB (`proxyClientMaxBodySize`), with a console warning and no error. A route whose limit is above 10 MB, a signed route among them, then sees a truncated body. When the request declared a `Content-Length` and the body read is shorter, the boundary answers the api's 500 with a log naming `experimental.proxyClientMaxBodySize`, failing closed as ADR 0020 does for a body read before it, rather than a `schemaInvalid` 400 or a signature 401. A truncated chunked body cannot be told apart, so the guide says to raise `experimental.proxyClientMaxBodySize` above the api's largest route limit.

Step 8b runs in the shared `runInputSteps`, between the access steps and the handler call, at Hono's call site; ADR 0028's claim release reaches Next with no Next code.

### Errors and the outgoing check

The handler catches every error: a generated contract exception, its own refusals, an error whose `status` is 401, 403 or 429, and any other throw. It answers each in the api's format, the last as the api's 500 after `reportContractError` calls `onUnexpectedError`, under the development log of ADR 0016 "Amendment 2026-10-28". No error reaches Next's HTML 500. `renderContractError(request, error)` gives the app's Node code, its own routes or its `proxy.ts`, the same reply for a contract error; a legacy Edge `middleware.ts` cannot import it, since the generated module refuses Edge when it loads.

There is no `fetch` to wrap. Each call opens its request slot with `servedInRequestSlot(() => serve(request))`, and the `Response` it returns passes `checkOutgoingResponse` with ADR 0020's verdict rules and `responses` modes. A reply the app's proxy writes before the route runs is not checked, as an app middleware's reply before the boundary is not on Hono; headers the proxy or `next.config` adds after the route apply to the reply on its way out.

### Generated imports

Every relative import of the generated tree is extensionless: the target's own modules and the modules its links write for it (the zod validators, the types). The specifier comes from the one shared helper of codegen-core that writes `.js` today, with the specifier style chosen by the target. The runtime package is unaffected, since it ships JavaScript.

### The boot check

`routeHandler` runs ADR 0020's boot check when the route module loads and throws, listing every problem: the version guard of ADR 0025, the hook problems, an unbound handler, and an unknown `operations` key.

There is no framework-route boot check on Next.js. On Hono it lists the app's routes from the app object and the wrapped `fetch` refuses to serve until it passed; Next keeps its routes in the file system and its build output, gives a route handler no app object and no start hook, and has no `fetch` to wrap. Nothing replaces it at run time: the catch-all still answers every request that reaches it with the contract's match, and a more specific app route file under a base path is the one way past the boundary. The guide says to keep app routes and rewrites outside the api's base paths. Since no check reads them, `generate` refuses by name a `frameworkRoutes` allow-list on a Next.js entry and an explicit `artefacts.bootCheck.frameworkRoutes` other than `false`. A `generate`-time scan of the app directory waits by name: it would list the `route.*` and `page.*` files at or under a mounted base path other than the api's catch-all, with route groups `(x)` and slots `@x` removed and `_private` folders skipped, and refuse each one that `frameworkRoutes` does not allow-list; it would still miss rewrites and files added after `generate`. Until it lands, this target is the named exception to CHK-062 and CHK-063 in the conformance checklist.

### What the generated code depends on

At run time: `@seampact/server-runtime` (root, `/web` and `/next`) at the generator's version (ADR 0025), the zod link's runtime and, for types only, `@seampact/hooks`. The generated code imports nothing from `next`. `generate` checks the installed `next` against the supported line, Next.js 16, through the compatibility matrix.

### Refused by name or waiting

`generate` refuses by name everything ADR 0020 "Refused by name or waiting" lists. Its path segments Hono's router cannot read are refused here too, though the raw match reads them and Next never routes inside the catch-all: they stay refused until the Next consumer proves them. On this target also, by who refuses:

| Who | What |
|---|---|
| `generate`, by name | a `frameworkRoutes` allow-list on the entry (`frameworkRoutes.unsupported`); an explicit `artefacts.bootCheck.frameworkRoutes` other than `false` (`artefacts.bootCheck.frameworkRoutes.unsupported`); an api with an empty base path, whose catch-all would sit at the app's root (`path.base.empty.unsupported`); `catchAll: false` on the entry, since the catch-all route file is the api's only route and answers every path under its base path (`options.catchAll.unsupported`); two apis whose base paths are equal or nested, such as `/v1` and `/v1/admin`, where Next's more specific catch-all would take the outer api's paths and answer with the inner api's 404, as ADR 0024 refuses on Symfony (`path.base.shared.unsupported`); Next.js 15 and older, through the compatibility matrix |
| the generated module, when it loads | the Edge runtime (`runtime.edge.unsupported`) |
| the handler, at the first request | a raw path under no mounted base path ("Routes") |
| nobody, and harmless | one route file per contract path, which the raw match serves correctly |
| waits for an app that needs it | the framework-route scan of the app directory ("The boot check"); a `proxy.ts` counterpart of `renderPreRoutingError` and `isContractRoute` |

### Delivery

| PR | Delivers |
|---|---|
| nextjs-1 | the `/next` runtime export and the Web steps moved out of `hono.ts`, with the Hono tests green; a live test on a real Next.js app with the packed runtime tarball, under Turbopack, covering the spike's cases, the module instance under `next dev`, and the `GET` prerender under `cacheComponents` |
| nextjs-2 | `@seampact/codegen-nextjs`: `next.ts`, the extensionless imports through the shared helper, the Edge, `frameworkRoutes` and base-path refusals; `docs/backend/nextjs.md`; the consumer running the http-suite and the conformance rows |

## Spike

Run on Next.js 16.4.5, Node 24.21 and zod 4.6.7, outside the repo and not kept. The generated Hono tree of the reference contract (zod link, `bodyValidation: true`) served through a hand-written route handler of about 75 lines that called the Web pieces of `@seampact/server-runtime` unchanged, under `next dev --webpack` and `next build --webpack && next start`. Requests sent with curl.

| Case | Result |
|---|---|
| `GET /v1/health`; a task without and with a bearer | 200, reply checked; 401 `api.unauthenticated`; 200 |
| `POST` of a task with `{"title":5}` | 400 `api.schema_invalid`, issues `/idempotency-key` and `/title` |
| the same valid `POST` twice with one `Idempotency-Key` | 201, then 201 with `idempotency-replayed: true` |
| a signed webhook with odd whitespace; one byte changed | 204; 401 |
| a handler answering an undeclared 418; the boundary's reply swapped for a 418 | 500 `api.internal` both times |
| `app/v1/[...path]` and `app/v1/[[...path]]` on `/v1` | Next's 404; the boundary |
| `params` for `a%2Fb` and `%73earch`; `/v1/%68ealth` matched on `request.url` | `a/b` and `search`; the contract 404 |
| a per-path file beside the catch-all; a static sibling without its own file | the per-path file served; routed to the placeholder file, refused by the raw match |
| `/v1/health/`, `/v1//health`, by default and with `skipTrailingSlashRedirect` | 308 both; the boundary's 404, and 308 |
| `/v1/channels/%E0%A4%A` | Next's own 500 (400 HTML in development) |
| an unexported method; `HEAD` | Next's 405; the `GET` handler |
| a declared length over 1 MiB; chunked over it | 413 before reading; 413 while reading |
| a 12 MB body with a `proxy.ts` present | truncated to 10 MB with a console warning; the boundary's 413 |
| the Edge runtime in development | deprecation warning; `?path=health` added to `request.url`, every request 400 |
| a catch-all and a per-path file under `next start` | one module instance for both |
| a throw in a route handler | Next's HTML 500 |
| `next dev` and `next build` with Turbopack on the generated tree | `Can't resolve '.../input.js'` |

Not run: step 8b, which is not in the runtime yet; the codegen of this target; Next.js 15; `cacheComponents`; a Next `basePath`; Turbopack's module instances; a deployment platform other than `next start`.

## Consequences

- App input rules ([ADR 0028](0028-app-input-rules.md)): Next.js: step 8b runs in the shared `runInputSteps`, with `inputRules` in the `routeHandler` options.
- An app keeps its pages, its other route files, its proxy and its `next.config`; on contract routes the boundary's checks and reply win.
- An app `route.*` or `page.*` file at or under an api's base path, a route group resolving there, and a rewrite bypass the boundary, with no check to catch them; this target is the named exception to CHK-062 and CHK-063 until the app-directory scan lands.
- `skipTrailingSlashRedirect` is app-wide, so the app's own pages lose their trailing-slash redirect; without it, the contract's trailing-slash 404 is lost.
- A Next `basePath` the entry's `mount` does not state answers the api's 500 on every contract request, with the fix in the log.
- `//` in a path and a malformed percent-escape get Next's answers, outside the api's format.
- A route limit above 10 MB needs `experimental.proxyClientMaxBodySize` raised when the app has a proxy.
- The Hono placement and this one share their Web steps; a fix in one reaches both.
- Every generated relative import is extensionless on this target, its links' files included.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries), FR-25 (framework routes and the boot check), FR-35 (the shared suite); amendments A30, A40, A41, A47.
- ADRs: 0007 (names, generated modules), 0009 (links, matrix), 0012 (placement and obligations), 0013 (raw body), 0016 and 0020 (the shared obligations and the Web adapter this target runs on), 0025 (runtime packaging), 0028 (app input rules).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the Next.js consumer.

# ADR 0020: The Hono server target and the Web-standard adapter

Status: accepted

## Context

ADR 0016 fixes, for the first Node server target, the obligations every Node server target meets with the shared request checks of `@seampact/codegen-core/node-server`: the check order of ADR 0012, a reply written by the boundary, exceptions handled narrowly, the outgoing response check and its `responses` modes, the raw-body check, the body limit, query decoding and the bounded values. `@seampact/codegen-hono` generates, per api of the app config, a registration that places those checks around a developer handler map on a Hono 4 app. This ADR states what Hono changes, and the one new piece it needs: an adapter of the shared checks to the Web-standard `Request` and `Response` that Hono runs on. What it does not restate holds as ADR 0016 says.

The four Node targets meet the boundary on Node's `IncomingMessage` and `ServerResponse`: a framework's parser reads the body, and the outgoing response check wraps `res.writeHead`, `res.write` and `res.end`, which every reply passes through. Hono has neither. A handler receives a `Request` and returns a `Response`; the app's `fetch(request)` returns the final `Response`, which the platform adapter (`@hono/node-server` on Node, the runtime itself on Bun, Deno and Cloudflare Workers) then writes. The same shape serves Next.js route handlers, so an adapter written against `Request` and `Response` alone serves the Web-standard targets planned after 1.0 as well.

Three Hono behaviours shape the placement. Hono runs every handler and middleware whose path matches a request in registration order, and the first that returns a reply ends the chain. A middleware registered before a route wraps it: it may answer without calling `next()`, and after `await next()` it may change the reply (`hono/etag` adds an ETag and a 304, `hono/compress` encodes the body, `hono/cors` adds headers). And an error thrown anywhere in the chain becomes, at the layer that threw it, the reply of the app's one `app.onError` handler.

## Options

- Adapter: Hono's Node bindings (`c.env.incoming` and `c.env.outgoing` under `@hono/node-server`) with the existing Node checks, or a Web-standard adapter on `Request` and `Response`. Choice: Web-standard; the Node bindings exist only under `@hono/node-server`, and the adapter is meant for Bun, Deno, Workers and Next.js route handlers later.
- Where the outgoing check sits: a Hono middleware of the registration, or a wrapper around the app's `fetch`. Choice: around `fetch`; a middleware sits inside every middleware the app registered before it, so an outer `etag()` would add its ETag and 304 to contract replies after the check. Only the `Response` that `fetch` returns is the wire, as `ServerResponse` is on Node.
- Registration: a generated Hono sub-app mounted with `app.route('/', ...)`, or a generated function that registers on the app itself. Choice: on the app; the check must wrap the `fetch` of the app that serves, the base-path registry of ADR 0016 is keyed by that app, and `app.route` copies a sub-app's routes but not its `fetch`.
- Request context: Node's `AsyncLocalStorage`, as the Node targets use, or a `WeakMap` keyed by the `Request`. Choice: `AsyncLocalStorage`; middleware may replace `c.req.raw` (`hono/body-limit` wraps a chunked body in a new `Request`), so the `Request` is no stable key.
- Validation: `@hono/zod-validator` on each route, or the zod link inside step 6's one pass. Choice: the zod link; `zValidator` validates one part per middleware (`json`, `query`, `param`), stops at the first failing part and answers in its own format, where ADR 0012 reports every issue of path, query, headers and body at once.
- Typed client: Hono's `hc`, or the target-neutral `codegen-fetch` client. Choice: `codegen-fetch`; `hc` infers its types from the app's route types, which a registration over the route table does not carry per route, and ties the client to Hono, while the contract's client comes from the contract.

## Decisions

### The Web-standard adapter

The shared runtime is split by what it imports, without changing a rule:

- Neutral modules, imported by every server target: the route table types, `matchContractRoute`, the access, input, idempotency and reply steps, the contract error rendering, the base-path registry, and the verdict rules of the outgoing check (an undeclared status, a framework ETag or 304, an error body outside the api's format or codes, the held-body cap, the `responses` modes); decoding a held body is each profile's own, `node:zlib` on Node and `DecompressionStream` on the Web. They import no `node:` module but `node:async_hooks` for the request context: the SHA-256 digests (the strong ETag, the throttle bucket key, the idempotency key) move from `node:crypto` to Web Crypto (`crypto.subtle.digest`), with the same bytes and the same hex and base64url text, so every key and ETag stays equal across targets.
- Node modules, imported by the four Node targets only: the `IncomingMessage` request view, the Express body glue, and the `ServerResponse` side of the reply and the check (`writeContractReply`, `installOutgoingCheck`, `respondWithError` and `respondNotServed` writing on `res`).
- Web modules, imported by the Hono target and the Web-standard targets after it: the `Request` request view and bounded body read, `contractResponse(reply)` building a `Response` from the boundary's reply, and `checkOutgoingResponse(context, request, response)` returning the `Response` that goes out.

`nodeServerRuntimeFiles()` takes a profile: `node` copies the neutral and Node modules into `node-server/`, as today; `web` copies the neutral and Web modules into `web-server/`. A test of codegen-core keeps the `web` profile free of any `node:` import other than `node:async_hooks`, which Bun, Deno and Next.js provide and Workers provide with the `nodejs_als` or `nodejs_compat` flag. The Web modules take a `Request` and return a `Response` and import no framework, so a Next.js route handler or a `Bun.serve` placement calls them as the Hono placement does.

The Web adapter differs from the Node path in five ways:

- Request target: the path and the raw query come from `request.url`, the only target a `Request` carries. The URL parser has already resolved dot segments, percent-encoded ones (`%2e`, `%2E`, `%2e%2e`) included, and turned `\` into `/` (`@hono/node-server` re-parses such a target, and any target holding `%`; spike), so `/v1/tasks/x/../7` and `/v1/tasks/%2e%2e/tasks/7` reach `/v1/tasks/7` on this target, where the Node targets answer the base-path 404. Any other percent-encoding, `//` and a trailing slash are kept as sent, so the raw-path matching of ADR 0016 holds. A client built on WHATWG `URL`, the fetch client among them, cannot send a dot segment.
- Headers: read from the request's `Headers`, which joins a repeated header into one comma-separated value; a repeated single-valued header reaches the checks so, and the authenticate hook, the media-type check or step 6 refuses it. This differs from the Node targets, where Node keeps the first `Authorization` or `Content-Type` line: two `Authorization` lines that pass there answer 401 here, two `Content-Type` lines 415. The client address is not part of a `Request`: the registration option `clientAddress(c)` supplies it (the README passes `getConnInfo(c).remote.address` from `@hono/node-server/conninfo`); without it the hooks' request view has none.
- Body: the boundary reads the body of `c.req.raw` itself, never through a framework parser; it reads `c.req.raw` and not the `Request` the wrapper received, since `hono/body-limit` replaces `c.req.raw` with a new `Request` around a chunked body and the original is then used, and it tests `bodyUsed` on the same `c.req.raw`. It refuses a declared `Content-Length` above the route's limit before reading, decodes a `Content-Encoding` of `gzip`, `deflate` or `br` with `DecompressionStream`, counts both the encoded and the decoded bytes while reading, and cancels the stream with the route's 413 as soon as either passes the limit. Any other content coding, or a format the runtime's `DecompressionStream` lacks, answers the 415; a corrupt compressed body is the client's 400. The raw bytes of signed routes are therefore present without app setup, unless an app middleware read the body first ("Errors raised before the boundary"), and this target exports no limit constant.
- Streaming: a `Response` body is a stream the check passes on untouched for a declared success, chunk by chunk; an error body is read up to `MAX_CHECKED_ERROR_BODY_BYTES` and sent again as read.
- The outgoing check sees one `Response` whose status and headers are final before any byte goes out, instead of `writeHead` calls; it returns that response, a copy with its headers changed (an ETag stripped), or the 500 that replaces it, and never writes on a socket.

### Placement

The developer writes handler objects implementing the generated interfaces of the api (ADR 0007 `handlers`) and registers them on the app that serves:

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import * as TasksHono from "./__generated__/hono/tasks/hono.js";

const app = new Hono();

TasksHono.registerRoutes(app, { handlers: { TasksEndpoints: tasksHandlers }, hooks });
serve({ fetch: app.fetch, port: 3000 });
```

`handlers` holds one object per generated interface, keyed by the interface's name as ADR 0007 derives it; the interface's methods are called on that object, so a class instance keeps its `this`. `registerRoutes` does three things:

- It wraps the app's `fetch` once per app, whichever api registers first (a marker in the shared registry, so a second api's copy does not wrap again). The wrapper opens an empty request slot with `boundaryContext.run`, calls the original `fetch`, and, when a contract route's handler entered the slot, runs `checkOutgoingResponse` on the `Response` before returning it. `serve({ fetch: app.fetch })`, `export default app` on Bun and Workers, and `app.request()` in tests all go through it.
- It registers, for each operation of the route table, one route handler that runs every step: it fills the slot (operation, settings, raw path match), runs step 1's media-type check and bounded body read, steps 2 to 5, steps 6 to 8 with the zod link's `input` validator, calls the developer's method (step 9) and returns the reply (step 10). Hook calls are wrapped as ADR 0016 states. Hono's own denial is an error whose `status` is 401 or 403 (`HTTPException` from `hono/jwt`, `hono/bearer-auth`): thrown inside a decide hook it answers the requirement's first declared denial code, and any other failure of a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").
- After the routes, it registers the catch-alls of "Routes" below.

A request whose route handler finds no slot was served by a `fetch` that is not the wrapped one: `app.fetch` read before `registerRoutes` ran, or a sub-app the api was registered on and then mounted with `app.route`. It answers 500 in the api's format, with a log naming the fix (register on the app that serves, before reading its `fetch`), fail closed, since its reply would go out unchecked.

The registration is generated into the target's module of the api, `hono.ts`, re-exported by the api's `index.ts` (ADR 0007 "Amendment 2026-10-19: generated modules"). Its fixed exports are `registerRoutes`, `renderContractError`, `renderPreRoutingError`, `isContractRoute`, `MAX_CHECKED_ERROR_BODY_BYTES` and `MAX_RENDERED_ISSUES`; no export is named by an operation, so none takes the reserved-name suffix. Next to it, the generated tree holds the shared `routes.ts`, `handlers.ts` and `hooks.ts` modules and the `web` profile of the shared runtime under `web-server/`, copied with the generated header (ADR 0009 "What generated code depends on at run time"); this target adds one placement file that imports them.

### Routes

Route paths use Hono's syntax with positional parameter names (`/v1/tasks/:p1`); a `:` inside a static segment is literal (`/v1/tasks:batch`, spike). Hono reads a segment that starts with `:` as a parameter and `*` as a wildcard, with no escape, so `generate` refuses by name a static segment that starts with `:` or holds `*` (`path.segment.literal.unsupported`), and, as on Fastify, a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`).

The route table lists the operations most specific first, static segments before parameters, and the registration adds them in that order, since Hono runs the first matching handler registered. The boundary never reads `c.req.param()` or `c.req.query()`. It matches the raw path and the request's own method against the contract templates with the shared `matchContractRoute` and decodes the path with `decodeRequestParams`. Hono decodes the path before routing and its routers relax it on request (`strict: false`, and the `hono/tiny` and `hono/quick` routers by default, accept a trailing slash; spike), so when the route Hono runs and the raw-path match differ, the handler answers as the catch-alls below would, before any check: `/v1/tasks/%73earch` that Hono routes to `/v1/tasks/search` answers the path's `notFound` 404, and `/v1/tasks/7/` the api's base-path 404. No handler runs under another operation's access and input.

`HEAD`: Hono's `fetch` dispatches a `HEAD` request to the `GET` route and drops the body of its reply, while `c.req.method` stays `HEAD`; `matchContractRoute` serves `HEAD` with the path's `GET` operation, which runs fully (ADR 0016 "Errors raised before routing"). The outgoing check then sees a `Response` without a body and checks its status and headers only; an error body on `HEAD` is not checked, since none is sent, where the Node check still reads the chunks Node drops.

After the routes, the registration adds one `app.all` catch-all per contract path, answering a method the path does not serve (`OPTIONS` included) with the path's `notFound` 404 through the shared not-served reply, then one `app.all('<base>/*')` per base path of the api, which Hono also matches on the base path itself (spike). A base path the api alone claims among the apis registered on the app answers the api's `notFound` code there; a base path another api of the app also claims calls `next()`, so the other api's routes, the app's routes and its `notFound` handler answer (ADR 0016, the registry keyed by the Hono app). An empty surface prefix claims no path and gets no catch-all. A path outside the base paths never reaches the boundary. As with an Express router, an app route under a base path the api alone claims is served only when the app registers it before `registerRoutes`.

### The reply path

The boundary's reply, a 2xx among several, the derived 304, an idempotent replay and every contract error, is a `Response` built by `contractResponse` and assigned to `c.res` before the handler returns it. Hono merges into `c.res` every header a middleware set with `c.header()` before `await next()`, and that merge replaces a header of the same name the handler set (spike), so after the assignment the boundary sets its own names again and merges `Vary`, and records that `Response` object in the slot. A middleware that changes the reply after `await next()` replaces that object (Hono rebuilds `c.res` on `c.header()` after `next()`, and a middleware may assign a new body), so the check below no longer treats the result as the boundary's: it checks it as an app reply, sets the boundary's names on it again and merges `Vary`, as ADR 0016 "The outgoing response check" has them win on every contract reply. The body headers stay those of the final reply, since `hono/compress` encodes the body; `hono/cors` and `hono/secure-headers` keep their other headers.

### Exceptions on contract routes

The route handler answers, in the api's format, the generated contract exceptions, its own body-read refusals, and an error whose `status` is 401, 403 or 429, each mapped to the role of its status as ADR 0016 maps NestJS's classes; it reads the status only, so the generated code imports no Hono middleware. A refusal whose status the operation does not declare is a 500. Any other error is kept on the slot for `onUnexpectedError` and rethrown, which hands it to the app's `app.onError` (or Hono's default reply), untouched; the reply the app writes for it is checked below. An app's `onError` renders a contract error with `renderContractError(c, error)`, which returns the `Response` of the reply path above.

### The outgoing response check

The `fetch` wrapper checks every reply of a request whose contract route handler entered the slot: the boundary's own, a reply an outer middleware changed, and the app's `onError` reply for an error rethrown from the handler. A reply an app middleware writes before the route handler runs (a rate limiter's 429 written as text, a `cors()` preflight) is not checked, as on the Node targets where the check is installed by the boundary's first step. The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's, through the neutral modules the Node check also calls:

- The boundary's own `Response` object, the one recorded in the slot, passes untouched, its idempotency record already completed. A `Response` Hono rebuilt around the boundary's own body stream with the same status (a `c.header()` after `next()`, or `onError` returning `renderContractError`) passes as the boundary's own body, with an ETag other than the boundary's stripped and the boundary's header names set on it again. Any other `Response`, an outer middleware's rewrite of the boundary's reply included, is checked as an app reply by the rules below, an ETag other than the boundary's is stripped from it, and the boundary's names are set on it again with `Vary` merged; so a `hono/etag` 304 is a violation, and a contract error whose body a middleware replaced is checked for the api's format and code.
- A declared success status passes at once with its body stream untouched; under `bodyValidation` a JSON success body is read, decoded first when `hono/compress` encoded it, and validated.
- An undeclared status is a violation before any body byte is read.
- A declared error status has its body read up to `MAX_CHECKED_ERROR_BODY_BYTES`, decoded first when `hono/compress` encoded it (`gzip`, `deflate` or `br`, with `DecompressionStream`, the cap on the decoded bytes), and checked for the api's format and a listed code; the bytes as written go out.

Under `strict` a violation returns the api's 500 instead and calls `onUnexpectedError` with the kept exception or the violating reply; under `warn` the reply goes out as written with the violation logged once. An idempotent operation's record is completed here with the reply that goes out when the app wrote it, and abandoned after a 500.

### Errors raised before the boundary

App middleware registered before the api runs first on contract paths: `hono/jwt` and `hono/bearer-auth` throw an `HTTPException` 401, and `hono/body-limit` a 413. Such an error reaches the app's `onError` before any slot is entered. The target exports `renderPreRoutingError(c, error)`, which the app's `onError` calls first: on a request whose raw path matches a contract route's template and whose error has the status 401, 403 or 429, it returns that status's role reply in the api's format; it returns `undefined` for any other request or error, and the app answers. Without it, Hono's default or the app's format answers these refusals. A middleware that writes its own reply, without throwing, is not checked: the README's Hono setup shows a rate limiter whose handler throws an `HTTPException` 429 instead, and says not to put `bodyLimit` on contract paths, since each route bounds its own read. An app middleware that reads the body (`await c.req.json()`) skips contract routes with `isContractRoute(c)`; when the body was read before the boundary (`request.bodyUsed`), a route with a request body answers 500, fail closed, with a log naming the middleware fix, since neither the raw bytes nor the size the client sent can be recovered.

### Query and bounded values

The query is decoded from the raw query string of `request.url` by the IR's wire form, with form decoding (`+` is a space). Zero body bytes is no body. The media type is matched exactly, the issues bound, the throttle bucket key and the idempotency key are ADR 0016's.

### Options and registration

The target options are ADR 0016's: `responses` (`strict`, the default, or `warn`) and `bodyValidation` (`false`, the default, or `true`). The `registerRoutes` options are `handlers`, `hooks` as one value (`{ authenticate, deciders, scopeResolvers, idempotencyStore, onUnexpectedError }`, `onUnexpectedError` optional), `responses` and `bodyValidation` for the api, `operations`, the per-operation override keyed by the operation's identifier (`{ operations: { createTask: { responses: "warn" } } }`), and `clientAddress`, optional. An operation's override wins over the registration option, which wins over the target option. Two apis are two `registerRoutes` calls on the same app, each with its own boot check.

### The boot check

`registerRoutes` runs it when called and throws, so the module that builds the app fails and the app never serves; it lists every problem at once with the operation id, the name and the fix:

- the hook problems of ADR 0016's list (a missing authenticate hook, decider, scope resolver or idempotency store; two deciders claiming one name);
- a contract operation without a bound handler: `handlers` lacks the interface's object or the object lacks the method;
- a key of `operations` that names no operation of the api;
- a base path on the app: a route the registration added whose `basePath` (Hono's public `app.routes` entries) is not `/`, as `app.basePath('/api')` gives, which differs from the empty `mount` the slice allows;
- a second registration of the api on the same app.

The Hono major is not readable at run time; `generate` checks the installed `hono` against the peer range, as ADR 0009 "Artefacts and the compatibility matrix" says.

### Links and the client

The target links a `validators` provider of style `standard-schema` (`codegen-zod` in the slice) and the `types` provider (ADR 0009 "The provider seam"); the `link.missing` refusal applies when either is absent. It generates no client: a Hono app's typed client is the `codegen-fetch` client of the same contract, and the consumer's end-to-end test drives at least one operation through it.

### What the generated code depends on

At run time: `hono` 4 as a peer dependency, for its types and `Hono` instance methods only, the zod link's runtime and, for types only, `@seampact/hooks` (ADR 0009). It imports no Hono middleware, not `@hono/zod-validator`, and not `@hono/node-server`, which the app chooses.

### The consumer

The slice consumer is a Hono 4 app served by `@hono/node-server` 2 around the generated reference registration, booted by the target's live boundary test in the consumer layout the other Node targets' live tests use. It passes `clientAddress` from `@hono/node-server/conninfo`, registers `hono/cors` and `hono/compress` before the api, and calls `renderPreRoutingError` from its `onError`.

### Refused by name or waiting

`generate` refuses by name, with the case's code and its fix, everything ADR 0016 "Refused by name or waiting" lists for the slice apart from its NestJS platform and `class-validator` items, and the path segments of "Routes". The Web-standard runtimes other than Node, and Next.js route handlers, wait for their own targets after 1.0; this target runs on any runtime Hono serves, but the slice proves it on `@hono/node-server` only.

## Spike

Run on Hono 4.13.13, `@hono/node-server` 2.1.5 and Node 24.21, and not kept. A reduced registration wrapped `app.fetch` with an `AsyncLocalStorage` slot, registered routes with Hono's path syntax, a handler that matched the raw path and read the body itself, per-base-path catch-alls, and a reduced outgoing check on the returned `Response`; requests were sent raw with `node:http`.

| Case | Result |
|---|---|
| `serve({ fetch: app.fetch })` and `app.request()` after the wrap | both ran the wrapped `fetch`; the slot reached the route handler, a body sent in two packets included |
| api registered on a sub-app mounted with `root.route('/', sub)` | the routes served, the slot was absent (the 500 above) |
| `app.basePath('/api')` then registration | `app.routes` entries carried `basePath: '/api'` |
| `/v1/tasks/search`, `/v1/tasks/%73earch`, `/v1/tasks:batch` | the search route; Hono routed the second to the search route while the raw path matched `{id}` (the 404 above); the batch route |
| `/v1/tasks/7/`, `/v1//tasks/7`, `/v1` | the base-path catch-all with the default router; with `strict: false`, `hono/tiny` and `hono/quick`, the first reached the `{id}` route |
| `/V1/tasks/7` | Hono's `notFound` (outside the base path) |
| `/v1/tasks/x/../7`, `/v1/tasks\7` | `request.url` read `/v1/tasks/7`: served by the `{id}` route |
| `/v1/tasks/a%2Fb`, `/v1/tasks/%E0%A4%A` | the `{id}` route, the raw value kept for step 6 |
| `HEAD /v1/tasks/7`; `OPTIONS` and `PUT` on it | `HEAD` ran the `GET` route with `c.req.method` `HEAD`, no body; the catch-all answered both others |
| app route `/v1/health` registered after the api | answered by the catch-all; with the base path shared (`next()`), by the app route |
| signed route; `Content-Length` over the limit; chunked over the limit; gzip body; gzip expanding past the limit | raw bytes as received (`{"a": 1}`); 413 before reading; 413 while reading; decoded with `DecompressionStream`; 413 on the decoded count |
| `DecompressionStream` formats; a corrupt gzip body | `gzip`, `deflate`, `deflate-raw` and `brotli` available on Node 24; a `TypeError` (`Z_DATA_ERROR`) while reading |
| an app middleware reading `c.req.json()` before the route | `bodyUsed` true, the stream locked |
| `hono/body-limit` before the route, body over its limit | an `HTTPException` 413 to `onError` before the route handler |
| `hono/etag` before the route, matching `If-None-Match` | a 304 after the route handler, seen by the wrapper |
| `hono/compress` before the route, `onError` 404 for a rethrown error | the wrapper saw a gzip body, decoded and checked it; the client received it encoded |
| `onError` answering an undeclared 418 | seen by the wrapper: a violation |
| app middleware throwing an `HTTPException` 401 | `onError` before the route handler, no slot entered |
| a stream of three chunks 150 ms apart through the wrapper | three chunks at 150, 301 and 452 ms |
| `c.header('cache-control', ...)` and `Vary` before `next()`, the handler's own values | Hono's merge replaced the handler's values; after assigning `c.res` and setting its names again, the handler's `no-store` and merged `Vary` went out, the app's other headers kept |

## Consequences

- An app keeps its Hono instance, its middleware, its `onError` and its `notFound` handler; on contract routes the boundary's checks and reply win, and its own routes are unchanged.
- The boundary wraps the app's `fetch`; an app that serves another function, or registers the api on a sub-app, gets a 500 with the fix on contract routes instead of unchecked replies.
- Middleware registered before the api still wraps contract replies: its encoding and its other headers apply, the boundary's header names win, an ETag or 304 is stripped or refused, and a reply it writes before the route handler is not checked.
- The shared runtime gains a Web profile with no `node:` import but `node:async_hooks`, and its digests move to Web Crypto for every target, so the Web-standard targets after 1.0 reuse the checks without a fork.
- Dot segments, percent-encoded ones included, and backslashes are resolved before this target sees the path, where the Node targets answer the base-path 404; no WHATWG client can send them.
- A repeated `Authorization` or `Content-Type` line is joined, not reduced to its first value as on Node: a 401 or 415 here where the Node targets pass.
- On `HEAD`, the format and code of an error body are not checked, since Hono drops the body before the check; the Node targets check it.
- A middleware that rewrites a contract reply after `next()` gets its reply checked as an app reply, with the boundary's header names set again.
- The client address reaches the hooks only through the `clientAddress` option.

## Traceability

- FRs: FR-5 (the check order), FR-14 (a case refused by name), FR-15 (the typed client), FR-16 (server boundaries), FR-35 (the shared suite this boundary will pass); amendments A6, A30, A36, A39, A40, A41, A42, A47.
- ADRs: 0007 (names, generated modules), 0009 (links, run-time dependencies), 0012 (placement and target obligations), 0013 (raw body), 0016 (the shared obligations), 0017 and 0018 (the Node placements this one mirrors).
- Proof in the development phase: the review of this ADR, the spike above, and the slice's end-to-end gate on the Hono consumer.

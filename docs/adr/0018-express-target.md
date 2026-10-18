# ADR 0018: The Express server target

Status: accepted

## Context

ADR 0016 fixes, for the first Node server target, the obligations every Node server target meets with the shared request checks of `@seampact/codegen-core/node-server`: the check order of ADR 0012, a reply written by the boundary, exceptions handled narrowly, the outgoing response check and its `responses` modes, the raw-body check, the body limit, query decoding and the bounded values. `@seampact/codegen-express` generates, per api of the app config, a router factory that places those checks around a developer handler map. This ADR states only what Express changes: the placement in Express's middleware chain, the compatibility of Express 4 and 5, the per-route body parser, the router's error middleware, the errors raised before the router and the refusals. What it does not restate holds as ADR 0016 says.

ADR 0016's NestJS target runs on Express, so the platform behaviours are the same: `res.send` and `res.json` add a weak ETag and answer 304 on their own, and a body parser placed by the app runs before any route. Two Express behaviours shape the rest. Middleware placed before the router, and a path no route serves, never enter the router: while an error is pending, Express skips every layer that is not an error middleware, a mounted router included. And Express 4 does not forward a rejected promise to the error middleware, where Express 5 does.

## Options

- Express majors: Express 5 only, or Express 4 and 5 in one target. Choice: both, through a small compatibility layer (below) that keeps the generated code identical; the slice consumer runs on each major.
- Body parsing: the app's global JSON parser, or a parser per contract route. Choice: per route; the route's parser bounds the read at the route's own limit and keeps the raw bytes of signed routes without app setup. A global parser that already read the body is detected and logged, and the setups of ADR 0016 still apply to it.
- Before-the-router refusals: left to the app's format, or rendered by an exported error middleware and helper. Choice: exported, as ADR 0016 "Errors raised before routing" does for NestJS; a path no route serves still falls through to the app ([A36](../decisions.md#a36)).

## Decisions

### Placement

The developer writes handler objects implementing the generated interfaces of the api (ADR 0007 `handlers`) and mounts the router with them:

```ts
import * as TasksExpress from "./__generated__/express/tasks/express.js";

app.use(TasksExpress.router({ handlers: { TasksEndpoints: tasksHandlers }, hooks }));
```

`handlers` holds one object per generated interface, keyed by the interface's name as ADR 0007 derives it, since a target never re-cases a name on its own; the interface's methods are called on that object, so a class instance keeps its `this`. `router()` returns an Express router with, per operation of the generated route table, one route whose middleware run in this order:

1. Enter: checks the mount (below), opens the request context with `boundaryContext.run(context, next)`, installs the outgoing response check on `res`, and runs step 1's media-type check. The context reaches every later middleware and the handler, a body read in several packets included (spike).
2. Body: the per-route parser (below), then step 1's body-limit check on the parsed byte count.
3. Access: steps 2 to 5, authenticate over the raw body for a signed identity, principal requirements, scopes and requirements.
4. Input: steps 6 to 8, the input validated in one pass with the zod link's `input` validator, restricted input fields and sort keys, principal bindings.
5. Handler: calls the developer's method (step 9) and writes the reply (step 10, below).

After the routes, the router holds one catch-all per contract path (`router.all` on the path's pattern) that answers the path's `notFound` 404 in the api's format, then its own error middleware (below). Hook calls are wrapped as ADR 0016 states; Express's own denial is an error whose `status` or `statusCode` is 401 or 403 (`http-errors`, `express-jwt`): thrown inside a decide hook it answers the requirement's first declared denial code, and any other failure of a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").

The router factory is generated into the target's module of the api, `express.ts`, re-exported by the api's `index.ts` (ADR 0007 "Amendment 2026-10-19: generated modules"). Its fixed exports are `router`, `preRoutingErrorHandler`, `renderPreRoutingError`, `renderContractError`, `isContractRoute`, `keepRawBody`, `LARGEST_BODY_LIMIT`, `MAX_CHECKED_ERROR_BODY_BYTES` and `MAX_RENDERED_ISSUES`; no export is named by an operation, so none takes the reserved-name suffix. Next to it, the generated tree holds the shared `routes.ts`, `handlers.ts` and `hooks.ts` modules and the shared request checks under `node-server/`, copied with the generated header (ADR 0009 "What generated code depends on at run time"); this target adds one placement file that imports them, and takes the Express body handling it shares with the NestJS target (the raw-bytes `verify` function, the parsed byte count, a parser error mapped to its contract role) from the same shared checks.

### Express 4 and 5

The generated code is the same on both majors; the compatibility layer is three rules:

- Route paths are anchored regular expressions built from the contract's path template, each literal escaped and each parameter a non-capturing `(?:[^/]+)`. Both majors accept them alike, while their string path syntaxes (`path-to-regexp` 0.1 and 8) read the same characters differently. A regular expression also matches only the exact case and slashes of the contract path. The groups capture nothing because both majors decode every capture while matching the layer: a malformed percent-encoding (`/tasks/%E0%A4%A`) would throw a 400 `URIError` before the route's first middleware, outside the boundary, where ADR 0016 keeps such a value raw for step 6 to report.
- Express serves the first registered route whose pattern matches, so the router registers the route table's operations most specific first, static segments before parameters (`/tasks/search` before `/tasks/{id}`), and the shared `matchContractRoute` iterates the same order. When the route Express runs and the raw-path match name different operations, the boundary answers the path's `notFound` 404 before any check, so no handler runs under another operation's access and input.
- The boundary never reads `req.params` or `req.query`: it matches the raw path and the request's own method, not the route's, with the shared `matchContractRoute`, decodes the path with `decodeRequestParams`, and decodes the raw query string of `req.originalUrl` by the IR's wire form, with form decoding (`+` is a space). Express 4's default `qs` parser and Express 5's `simple` parser therefore change nothing. Both majors run a `HEAD` request through the `GET` route's middleware; the contract serves no `HEAD`, so the boundary answers it with the path's `notFound` 404.
- Each of the boundary's own async middleware forwards a rejection to `next`, so a contract exception reaches the router's error middleware on Express 4 as on Express 5. The developer's handler and the hooks are called from inside them.

The reply is written with `res.statusCode`, `res.setHeader` and `res.end`, the same Node methods on both majors. The slice consumer runs once on the latest Express 4 and once on the latest Express 5, in one workflow matrix.

### The reply path

Every reply of a contract route the boundary writes goes through the shared `writeContractReply` on `res`, never `res.send` or `res.json`: so no Express ETag or 304, as ADR 0016 "The reply path" states, while the app's own routes keep Express's settings.

### Exceptions on contract routes

The router's final error middleware answers, in the api's format, only the generated contract exceptions, every client error (4xx) of the route's own body parser by its status (a corrupt compressed body, a length mismatch or an aborted request is a 400, not a 500), and an error whose `status` or `statusCode` is 401, 403 or 429, each mapped to the role of its status as ADR 0016 maps NestJS's classes. Any other error is passed on with `next(error)` to the app's error middleware, untouched. A refusal whose status the operation does not declare is a 500. An app error middleware renders a contract error with `renderContractError(res, error)`, which writes it through the reply path above.

### The outgoing response check

The router's first middleware installs the shared `installOutgoingCheck` on `res`, so it sees every reply on a contract route: the boundary's writes, `res.json` from the app's error middleware, and a piped stream. It strips an Express ETag and treats a 304 it did not write as a violation. Its rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's "The outgoing response check". An app's `compression` middleware mounted before the router wraps `res` first, so the check, installed later, wraps outside it and reads the body before it is encoded (spike).

### Errors raised before the router

App middleware mounted before the router (`express-jwt`, a global `express.json()` that fails to parse or exceeds its limit) refuses before the boundary, and its error never enters the router. A path no route serves falls through to the app. A method a contract path does not serve reaches the router's catch-all for that path and answers its `notFound` 404 (ADR 0016); `OPTIONS` included, which Express's router would otherwise answer itself with `200` and an `Allow` header, so an app's CORS middleware is mounted before the router to answer preflights. The target exports, per api:

- `preRoutingErrorHandler`, an error middleware the app mounts after the router and before its own error middleware;
- `renderPreRoutingError(req, res, error?)`, for an app's own error middleware and its final 404 handler; it returns whether it wrote a reply.

Both act only when the boundary's request context is absent and the request matches a contract route's path template; then they render, in the api's format, a body-parser error by its role (by its `type`: `entity.parse.failed` 400, `entity.too.large` 413, `encoding.unsupported` and `charset.unsupported` 415), an error whose status is 401, 403 or 429, or, without an error, the route's `notFound` 404. A parser 413 whose limit is below the route's limit is a setup error, answered 500 with a log naming `LARGEST_BODY_LIMIT` (ADR 0016). On any other request the middleware calls `next(error)` and the helper returns false. Without either, the app's own format answers these refusals, with Express's weak ETag; the README's Express setup shows both forms. A reply such middleware writes itself, without calling `next`, is not checked. `express-rate-limit` writes its 429 so by default; its `handler` option calls `next(error)` with an error whose status is 429 instead, which `preRoutingErrorHandler` renders in the api's format, and the README's Express setup shows it. Skipping contract routes or mounting the limiter after the router would turn throttling off on them, since the router answers first.

### Raw body and body limit

Each contract route with a JSON body has its own `express.json({ limit, verify, strict: false })`, the limit being the route's own: its `verify` function keeps the raw bytes on the request for signed routes only and records the parsed byte count on every route. `strict: false` lets a JSON scalar body parse, so a value of the wrong type is a step 6 issue (ADR 0012 step 1), as on Fastify, and not a malformed-body 400. The per-request raw-body check of ADR 0016 stays: a signed route without raw bytes answers 500, fail closed, with a log naming the operation and the fixes.

An app-wide JSON parser mounted before the router reads the body first, and the route's parser then skips it. The route's body middleware detects this by the request stream already ended (`req.readableEnded`), since Express 5 no longer sets Express 4's `req._body` flag (spike), and logs a warning once per route naming the fixes: mount the router before the global parser, or give that parser `verify: TasksExpress.keepRawBody` and `limit: TasksExpress.LARGEST_BODY_LIMIT`. The route then follows ADR 0016's rules for the app's own parser: the parsed byte count when `keepRawBody` recorded it, else `Content-Length` for an identity body, else 500, fail closed.

### Mount, options and registration

The router serves the contract paths at the app's root. Express gives a router no public way to read its mount path when `router()` is called, so the first middleware checks `req.baseUrl` per request: a router mounted under a path (`app.use('/v1', router)`) answers 500 with a log naming the mount, as ADR 0016 does for NestJS's global prefix.

The target options are ADR 0016's: `responses` (`strict`, the default, or `warn`) and `bodyValidation` (`false`, the default, or `true`). The `router()` options are `handlers`, `hooks` as one value (`{ authenticate, deciders, scopeResolvers, idempotencyStore, onUnexpectedError }`, `onUnexpectedError` optional), `responses` and `bodyValidation` for the api, and `operations`, the per-operation override keyed by the operation's identifier: `{ operations: { createTask: { responses: "warn" } } }`. An operation's override wins over the router option, which wins over the target option. Two apis are two routers, each with its own boot check.

### The boot check

`router()` runs it when called and throws, so the app does not reach `listen`; it lists every problem at once with the operation id, the name and the fix: the hook problems of ADR 0016's list, a contract operation without a bound handler (`handlers` lacks the interface's object or the object lacks the method), and a key of `operations` that names no operation of the api.

### What the generated code depends on

At run time: `express` 4 or 5 as a peer dependency, for `Router` and `express.json`, the zod link's runtime and, for types only, `@seampact/hooks` (ADR 0009).

### Refused by name or waiting

`generate` refuses by name, with the case's code and its fix, everything ADR 0016 "Refused by name or waiting" lists for the slice apart from its NestJS platform and `class-validator` items. Express adds no refusal of its own.

## Spike

Run on Express 4.22.3 and 5.3.0 (`compression` 1.8.2) and Node 24.21, and not kept. A router factory registered routes with the middleware above, a reduced model of the shared outgoing check installed from the first middleware, and a final error middleware that answered contract errors and passed the rest to the app's. Every result below was the same on both majors unless stated.

| Case | Result |
|---|---|
| boundary reply with `res.end`, `If-None-Match: *` | 200, no ETag, no 304 |
| contract exception rejected by the async handler | the router's error middleware answered 404 in the api's format, on Express 4 too |
| app error middleware, declared 404 in the format | passed |
| app error middleware, unlisted code; undeclared 418 | 500; under `warn`, 418 sent as written with a logged violation |
| app error middleware, `res.json` 200 with `If-None-Match: *` | Express's 304 became a 500 (a 304 the boundary did not write) |
| app error middleware, a stream of three chunks 150 ms apart | 200, three chunks at 150, 300 and 450 ms; with an undeclared 206, a 500 |
| app `compression` before the router, 4 KB declared 404 | the check read the identity body and passed it; the client received it gzip-encoded |
| malformed JSON; a body over the route parser's limit | 400 and 413 in the api's format |
| signed route | raw bytes kept as received (`{"a": 1}`, the space included) |
| global `express.json()` before the router | signed route: raw bytes absent, 500 fail closed; Express 4 set `req._body`, Express 5 did not, and `req.readableEnded` was true on both |
| app middleware before the router failing with a 401 | skipped the router, answered by the app's error middleware in its own format with a weak ETag |
| app async route rejecting | Express 5: the app's error middleware; Express 4: no reply, the request hung |
| regular-expression route, `/tasks/a%2Fb`, `/tasks/1/`, `/Tasks/1`, `/tasks:batch` | matched, not matched, not matched, matched |
| `/tasks/%E0%A4%A` on a capturing `([^/]+)`; on a non-capturing `(?:[^/]+)` | 400 `URIError` before the route's first middleware, answered by the app's error middleware; the route's middleware ran, nothing decoded |
| `GET /tasks/search` with `/tasks/([^/]+)` registered first | served by the `{id}` route |
| `OPTIONS /tasks/1`; `HEAD /tasks/1`, without a catch-all | 200 with `Allow` from the router itself (a weak ETag on Express 4), no route middleware run; `HEAD` ran the `GET` route |
| router mounted under `/v1` | `req.baseUrl` read `/v1`: 500 with a log |
| context opened with `run(context, next)`, body sent in two packets | read after the route parser, in the handler |
| non-contract route; unknown path | untouched, Express's weak ETag kept; the app's 404 |

## Consequences

- An app keeps its Express app, its middleware, its error middleware and its 404 handler; on contract routes the boundary's checks and reply win, and its own routes are unchanged, Express ETags included.
- One generated router serves Express 4 and 5; an app moves between majors without regenerating.
- App middleware mounted before the router is outside the boundary: its refusals are in the api's format only when the app mounts the exported error middleware or calls the helper, and a reply it writes itself is not checked. The README's setup mounts the router before such middleware where the order allows.
- A global JSON parser before the router works, with a warning, and costs the raw bytes of signed routes unless it uses `keepRawBody`.
- A mount path answers 500 per request, with a log naming the fix, instead of refusing to start.
- A contract path answers only its declared methods: `OPTIONS` and `HEAD` get the path's 404, so CORS preflights are answered by app middleware mounted before the router.

## Traceability

- FRs: FR-5 (the check order), FR-14 (a case refused by name), FR-35 (the shared suite this boundary will pass); amendments A36, A39, A40, A41, A42, A47.
- ADRs: 0007 (names, generated modules), 0009 (links, run-time dependencies), 0012 (placement and target obligations), 0013 (raw body), 0016 (the shared obligations).
- Proof in the development phase: the review of this ADR, the spike above, and the slice's end-to-end gate on the Express consumer, run on both majors.

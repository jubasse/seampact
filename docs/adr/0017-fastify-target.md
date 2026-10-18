# ADR 0017: The Fastify server target

Status: accepted

## Context

ADR 0016 fixes, for the first Node server target, the obligations every Node server target meets with the shared request checks of `@seampact/codegen-core/node-server`: the check order of ADR 0012, a reply written by the boundary, exceptions handled narrowly, the outgoing response check and its `responses` modes, the raw-body check, the body limit, query decoding and the bounded values. `@seampact/codegen-fastify` generates, per api of the app config, a Fastify plugin that places those checks around a developer handler map. This ADR states only what Fastify changes: the placement in Fastify's route lifecycle, the reply path, the plugin's error handler, the scoped JSON parser, the boot check and the refusals. What it does not restate holds as ADR 0016 says.

Three Fastify behaviours shape the placement. Each route runs its own lifecycle of hooks (`onRequest`, `preParsing`, `preValidation`, `preHandler`, `onSend`, `onResponse`), and Fastify parses the body after routing, so the body limit and a parse error belong to the route. An encapsulated plugin owns its error handler and its content-type parsers, which never reach the app's own routes. And `reply.send` runs the `onSend` hooks of every enclosing context, where plugins such as `@fastify/compress` and `@fastify/etag` rewrite the payload, the status or the headers.

## Options

- Plugin scope: an encapsulated plugin, or one wrapped with `fastify-plugin` that shares its hooks, parser and error handler with the app. Choice: encapsulated; its parser, error handler and hooks act on contract routes only, and the app's own routes are unchanged ([A36](../decisions.md#a36)).
- Reply path: `reply.hijack()` with the shared writer on `reply.raw`, or `reply.send` with the buffer the boundary renders. Choice: `reply.hijack()`; `reply.send` would run the app's `onSend` hooks on contract replies, where `@fastify/etag` adds an ETag and a 304 the contract does not declare. The spike below shows that the app's `onResponse` hooks, request logging included, still run after a hijack, so the `reply.send` fallback is not needed.
- Step 10: an `onSend` hook, as ADR 0012's table first said, or the shared outgoing response check on `reply.raw`. Choice: `reply.raw`; an `onSend` hook never runs for a hijacked reply and sees a stream as one object, while the check on the raw response sees every reply, chunk by chunk, with the one implementation every Node target shares.
- Validation without a linked validator: the Ajv fallback of ADR 0012 "Target obligations", or a refusal. Choice: refused in the slice ([A47](../decisions.md#a47)); the zod link serves the slice.

## Decisions

### Placement

The developer writes handler objects implementing the generated interfaces of the api (ADR 0007 `handlers`) and registers the plugin with them:

```ts
import * as TasksFastify from "./__generated__/fastify/tasks/fastify.js";

await app.register(TasksFastify.plugin, { handlers: { TasksEndpoints: tasksHandlers }, hooks });
```

`handlers` holds one object per generated interface, keyed by the interface's name as ADR 0007 derives it, since a target never re-cases a name on its own; the interface's methods are called on that object, so a class instance keeps its `this`. The plugin is encapsulated and registers, for each operation of the generated route table, one route with four route-level hooks and a handler:

- `onRequest`: opens the request context, installs the outgoing response check on `reply.raw` (below), and runs step 1's media-type check before the body is read. The context opened here with `boundaryContext.run(context, done)` reaches every later hook and the handler, a body read in several packets included (spike).
- `preParsing`: decodes a compressed body (below).
- The route's `bodyLimit` and the plugin's JSON parser (below) do step 1's bounded read.
- `preValidation`: steps 2 to 5, authenticate over the raw body for a signed identity, principal requirements, scopes and requirements.
- `preHandler`: steps 6 to 8, the input validated in one pass with the zod link's `input` validator, restricted input fields and sort keys, principal bindings.
- The route handler calls the developer's method (step 9) and writes the reply (step 10, below).

Hook calls are wrapped as ADR 0016 states. Fastify's own denial is an error whose `statusCode` is 401 or 403 (`@fastify/sensible`'s `httpErrors`, `@fastify/jwt`): thrown inside a decide hook it answers the requirement's first declared denial code, and any other failure of a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").

Route paths use Fastify's syntax with positional parameter names (`/tasks/:p1`) and a literal `:` doubled; the boundary never reads `request.params`. It matches the raw path and the request's own method, not the route's, against the contract templates with the shared `matchContractRoute` and decodes the path with `decodeRequestParams`. So a request that only Fastify's relaxed routing accepts answers the path's `notFound` 404 in the api's format: a path that only `ignoreTrailingSlash`, `caseSensitive: false` or `ignoreDuplicateSlashes` matches, and a `HEAD` request, which Fastify runs on the `GET` route (`exposeHeadRoutes`) while the contract serves no `HEAD`.

The route table lists the operations most specific first, static segments before parameters (`/tasks/search` before `/tasks/{id}`), and the plugin registers them in that order. Fastify's router prefers a static segment whatever the order; `matchContractRoute` iterates the same table, so the boundary picks the operation Fastify routed to.

The plugin is generated into the target's module of the api, `fastify.ts`, re-exported by the api's `index.ts` (ADR 0007 "Amendment 2026-10-19: generated modules"). Its fixed exports are `plugin`, `renderContractError`, `renderPreRoutingError`, `isContractRoute`, `MAX_CHECKED_ERROR_BODY_BYTES` and `MAX_RENDERED_ISSUES`; no export is named by an operation, so none takes the reserved-name suffix. Next to it, the generated tree holds the shared `routes.ts`, `handlers.ts` and `hooks.ts` modules and the shared request checks under `node-server/`, copied with the generated header (ADR 0009 "What generated code depends on at run time"); this target adds one placement file that imports them.

### The reply path

Every reply of a contract route the boundary writes, a 2xx among several, the derived 304, an idempotent replay and every contract error, goes through `reply.hijack()` and then the shared `writeContractReply` on `reply.raw`. Before writing, the boundary copies the headers set on the reply so far (`reply.getHeaders()`), so a header an app sets in an `onRequest` or `preHandler` hook, such as `@fastify/cors`'s, reaches the client. Headers and payload changes made in `onSend` hooks do not apply to these replies: `@fastify/compress` does not compress them, and `@fastify/etag` adds neither an ETag nor a 304.

### Exceptions on contract routes

The plugin's `setErrorHandler` answers, in the api's format, only the generated contract exceptions, the refusals of the plugin's own parser and of the route's body read (a malformed body, and every `FST_ERR_CTP_*` error with a 4xx status raised on the route, `FST_ERR_CTP_BODY_TOO_LARGE`, `FST_ERR_CTP_INVALID_MEDIA_TYPE` and `FST_ERR_CTP_INVALID_CONTENT_LENGTH` among them), and an error whose `statusCode` is 401, 403 or 429, each mapped to the role of its status as ADR 0016 maps NestJS's classes. It reads the status only, so the generated code imports neither `@fastify/rate-limit` nor `@fastify/jwt`. Any other error is rethrown, which hands it to the app's error handler (the parent context's), untouched. A refusal whose status the operation does not declare is a 500. An app error handler renders a contract error with `renderContractError(reply, error)`, which writes it through the reply path above.

An app's root-level hooks run before the route's `onRequest`. An error thrown there reaches the plugin's error handler without a request context; the handler finds the operation from the route's config and answers as above (spike). Before it rethrows an error outside that set, it installs the outgoing response check on `reply.raw` when it is absent, with the operation from the route's config, so the app error handler's reply is checked as on any contract request. A reply an app root hook writes itself is not checked, since the check is not installed yet; such a hook throws instead, or skips contract routes with `isContractRoute(request)`.

### The outgoing response check

`onRequest` installs the shared `installOutgoingCheck` on `reply.raw`, so it sees every reply on a contract route: the boundary's hijacked writes, `reply.send` from the app's error handler, and a stream. Its rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's "The outgoing response check".

A held body may arrive encoded: when the app's error handler sends an error body, `@fastify/compress` encodes it in a root `onSend` hook, before the raw write the check sees. The shared check therefore decodes a held body whose `Content-Encoding` is `gzip`, `deflate` or `br` with `node:zlib`, its decoded size bounded by `MAX_CHECKED_ERROR_BODY_BYTES`, checks it, and sends the encoded bytes as written; any other content coding is a violation. The rule belongs to the shared check, so it holds for every Node target.

### Errors raised before the plugin

Fastify parses after routing, so a malformed body and a body over the route's limit reach the plugin's error handler. Three cases stay outside the plugin:

- a request no route serves: an unknown path, and a method a contract path does not serve, `OPTIONS` included, which answers that path's `notFound` 404 (ADR 0016); it reaches the app's not-found handler;
- `FST_ERR_BAD_URL` (400), a path parameter that does not decode;
- `FST_ERR_MAX_PARAM_LENGTH` (414), a path parameter longer than the router's `maxParamLength` (100 by default).

Fastify's router writes the last two straight to the response in its own format, past every error and not-found handler, unless the app sets the server option `frameworkErrors`. The plugin exports `renderPreRoutingError(request, reply, error?)` for both places: the app's `setNotFoundHandler` calls it without an error, and the app's `frameworkErrors` function with the error. On a request whose path matches a contract route's template it writes, in the api's format, the `notFound` 404 without an error, or the matched operation's `schemaInvalid` 400 for either router error, since step 6 reports an undecodable or over-long path parameter the same way; it returns true. On any other request it returns false and the app answers. Without it, Fastify's default replies answer with their own status and format; the README's Fastify setup shows both calls.

### Raw body and body limit

The plugin adds its own parser for the JSON media types its routes declare, `parseAs: 'buffer'`, inside its encapsulated context. It decodes with the boundary's JSON decode, keeps the raw bytes on the request for signed routes only, and records the parsed byte count. Fastify refuses to add a parser for a media type that already has one in scope, and an app may have registered its own root `application/json` parser, so the plugin first removes the inherited parser of each declared media type (`hasContentTypeParser`, then `removeContentTypeParser`). The removal stays inside the plugin's context: the app's routes keep the app's parser (spike). The per-request raw-body check of ADR 0016 stays: a signed route without raw bytes answers 500, fail closed, with a log naming the operation.

Each route carries its own limit as Fastify's route `bodyLimit`, which refuses on `Content-Length` and bounds the read; it counts both the decoded and the encoded length when a `preParsing` hook decodes a compressed body and sets `receivedEncodedLength`. No app-wide parser limit applies to contract routes, so this target exports no `LARGEST_BODY_LIMIT`.

A compressed request body is inflated, as the Express and NestJS targets do with `body-parser`'s `inflate`, so one request gets one answer on every Node target. The route's `preParsing` hook decodes a body whose `Content-Encoding` is `gzip`, `deflate` or `br` with `node:zlib` and sets `receivedEncodedLength`, so `bodyLimit` bounds both lengths; any other content coding answers the 415 in the api's format. An app root `preParsing` hook that decodes bodies itself skips contract routes with `isContractRoute(request)`, since the body would be decoded twice.

### Query and bounded values

The query is decoded from the raw query string of `request.raw.url` by the IR's wire form, with form decoding (`+` is a space), never from `request.query`. The issues bound, the throttle bucket key and the idempotency key are ADR 0016's.

### Options and registration

The target options are ADR 0016's: `responses` (`strict`, the default, or `warn`) and `bodyValidation` (`false`, the default, or `true`). The plugin options are `handlers`, `hooks` as one value (`{ authenticate, deciders, scopeResolvers, idempotencyStore, onUnexpectedError }`, `onUnexpectedError` optional), `responses` and `bodyValidation` for the api, and `operations`, the per-operation override keyed by the operation's identifier: `{ operations: { createTask: { responses: "warn" } } }`. An operation's override wins over the plugin option, which wins over the target option. Each api is one plugin, registered once; two apis are two registrations, each with its own boot check.

### The boot check

The plugin runs it when Fastify loads it, so `app.ready()` and `app.listen()` reject and the app does not start; it lists every problem at once with the operation id, the name and the fix:

- the hook problems of ADR 0016's list (a missing authenticate hook, decider, scope resolver or idempotency store; two deciders claiming one name);
- a contract operation without a bound handler: `handlers` lacks the interface's object or the object lacks the method;
- a key of `operations` that names no operation of the api;
- a registration `prefix` (the plugin's `fastify.prefix`, readable at load, spike), which differs from the empty `mount` the slice allows;
- a router `maxParamLength` (`fastify.initialConfig`) below the largest `maxLength` declared on a path parameter, since Fastify would refuse a valid request with a 414; a path parameter without a `maxLength` is a warning naming it, not a failure;
- a Fastify major other than 5 (`fastify.version`).

### What the generated code depends on

At run time: `fastify` 5 as a peer dependency, the zod link's runtime and, for types only, `@seampact/hooks` (ADR 0009). It imports no `@fastify/*` plugin and not `fastify-plugin`.

### Refused by name or waiting

`generate` refuses by name, with the case's code and its fix, everything ADR 0016 "Refused by name or waiting" lists for the slice apart from its NestJS platform and `class-validator` items, and:

- `validators.ajv.unsupported`: no linked validator; the Ajv fallback of ADR 0012 "Target obligations" waits for a consumer without a validator library.

## Spike

Run on Fastify 5.12.7, `@fastify/compress` 9.2.2 and Node 24.21, and not kept. An encapsulated plugin registered routes with the `onRequest`, `preValidation` and `preHandler` hooks above, a reduced model of the shared outgoing check installed from `onRequest` on `reply.raw`, and an error handler that answered contract errors and rethrew the rest to the app's error handler.

| Case | Result |
|---|---|
| boundary reply through `reply.hijack()` and `reply.raw` | 200 as written; the app's `onResponse` hook ran with the right status; a header set by an app `onRequest` hook arrived (copied from `reply.getHeaders()`); an app `onSend` header did not; not compressed with `Accept-Encoding: gzip` |
| contract error thrown by the handler | the plugin's error handler answered 404 in the api's format |
| app error handler, declared 404 in the format | passed |
| app error handler, unlisted code; undeclared 418 | 500; under `warn`, 418 sent as written with a logged violation |
| app error handler, 4 KB declared 404 with `@fastify/compress` | arrived at the check gzip-encoded, so a check that does not decode makes it a 500 (the decoding rule above) |
| app error handler, a stream of three chunks 150 ms apart | 200, three chunks at 150, 300 and 450 ms; with an undeclared 206, a 500 and no chunk after it |
| malformed JSON; a body over the route's `bodyLimit` | reached the plugin's error handler: 400 and 413 in the api's format |
| signed route | raw bytes kept as received (`{"a": 1}`, the space included) |
| app routes | kept the app's JSON parser and its error format |
| app root `application/json` parser, then the plugin adding its own | boot failed with `FST_ERR_CTP_ALREADY_PRESENT`; with `hasContentTypeParser` and `removeContentTypeParser` first, it booted, the contract route used the plugin's parser and the app's route the app's |
| path parameter of 101 characters; `/tasks/%E0%A4%A` | 414 `FST_ERR_MAX_PARAM_LENGTH` and 400 `FST_ERR_BAD_URL` in Fastify's format, no error or not-found handler run, unless `frameworkErrors` is set |
| `HEAD /tasks/1`; `OPTIONS /tasks/1` | `HEAD` ran the `GET` route; `OPTIONS` reached the not-found handler |
| app root `onRequest` hook throwing a 401 | reached the plugin's error handler before any context, answered in the api's format |
| app root `onRequest` hook replying a 401 itself | went out unchecked |
| plugin registered with `prefix: '/v1'` | `fastify.prefix` read `/v1` inside the plugin |
| context opened in `onRequest` with `run(context, done)`, body sent in two packets | read in `preValidation` and in the handler |
| non-contract route; unknown path | untouched; the app's not-found handler |

## Consequences

- An app keeps its Fastify instance, its root hooks, its error handler and its not-found handler; on contract routes the boundary's checks and reply win, and its own routes are unchanged.
- Boundary replies skip every `onSend` hook: they are never compressed by `@fastify/compress` and carry no `@fastify/etag` validator; a header an app must add to them is set before the handler, in `onRequest` or `preHandler`.
- App error handlers keep working on contract routes; under `strict`, a reply of theirs outside the contract becomes a 500, and under `warn` a logged violation.
- A reply an app root hook writes on a contract route is not checked; the README's setup says to throw, or to skip contract routes with `isContractRoute`.
- An app that does not route Fastify's router errors through `frameworkErrors` answers an undecodable or over-long path parameter in Fastify's format; the boot check keeps `maxParamLength` above every declared bound.
- A registration prefix is refused at boot instead of answering 500 per request as NestJS's global prefix does.

## Traceability

- FRs: FR-5 (the check order), FR-14 (a case refused by name), FR-35 (the shared suite this boundary will pass); amendments A36, A39, A40, A41, A42, A47.
- ADRs: 0007 (names, generated modules), 0009 (links, run-time dependencies), 0012 (placement and target obligations), 0013 (raw body), 0016 (the shared obligations).
- Proof in the development phase: the review of this ADR, the spike above, and the slice's end-to-end gate on the Fastify consumer.

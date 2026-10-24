# ADR 0019: The AdonisJS server target

Status: accepted

## Context

ADR 0012 fixes what every server target generates around the developer's controller, and ADR 0016 states, for NestJS, how a Node server boundary meets those obligations: the check order, the reply path, the narrow handling of exceptions on contract routes and the outgoing response check. `@seampact/codegen-adonis` generates, for each api of the app config, the same boundary around the developer's AdonisJS controllers. In the end-to-end slice ([A47](../decisions.md#a47)) it validates with the zod link (ADR 0009 "The provider seam"); generated VineJS validators ([A15](../decisions.md#a15)) come after it.

The request checks are the framework-neutral ones of `@seampact/codegen-core/node-server`, shared with the NestJS, Fastify and Express targets, and this ADR cites ADR 0016 for every obligation they meet. Only the placement is new. Four behaviours of AdonisJS shape it: route middleware run in a fixed order after the router's middleware, the bodyparser among them; an error thrown inside a route's pipeline goes straight to the app's exception handler and never back through an earlier middleware's `await next()`; the response is written lazily once the pipeline ends; and the JSON parser can rewrite string values.

## Options

- AdonisJS majors: 7 only, or 6 and 7. Choice: both, since the spike below ran the same boundary code on both with the same wire results. AdonisJS 6 would be refused by name if a later change needed different generated code for it.
- Placement of the checks: named middleware registered in the app's `start/kernel.ts`, or inline route middleware attached by the generated registration. Choice: inline middleware; the app's kernel is unchanged and the generated routes fix the order.
- Reply path: Adonis's lazy `response.send`, or the shared writer on the Node response. Choice: the shared writer, as in ADR 0016; one writer for every Node target, and no Adonis ETag on boundary replies.
- Exceptions on contract routes: catch them in the first route middleware around `await next()`, or where they are thrown. Choice: where they are thrown, since the spike showed that an error from the controller never reaches an earlier middleware.
- Raw body for signed routes: a generated stream capture before the bodyparser, or the bodyparser's `request.raw()`. Choice: `request.raw()`, re-encoded as UTF-8, failing closed when it does not give the signed bytes.
- Hooks: bindings in the IoC container, or one value passed to the registration. Choice: one value, as NestJS's `forRoot` takes it; container bindings come later.

## Decisions

### Placement

The developer writes a controller class per resource that implements the generated interface (ADR 0007 `handlers`), and registers the api from `start/routes.ts`:

```ts
import router from '@adonisjs/core/services/router'
import * as TasksAdonis from '../__generated__/tasks/adonis.js'

TasksAdonis.registerRoutes(router, {
  controllers: { TasksEndpoints: () => import('../app/controllers/tasks_controller.js') },
  hooks: { authenticate, deciders, scopeResolvers, idempotencyStore },
})
```

`controllers` maps each resource interface to a lazy import of its controller, typed so that the class must implement that interface. Codegen emits, per api, under the target entry's `out`, a registration that adds each operation's route with the verb and the full contract path (`{id}` becomes `:id`), named `<api>.<operation>` with `.as()`, then three inline route middleware attached with `.use()`, in this order:

1. Step 1 and the request context: it opens the request context (`AsyncLocalStorage`, ADR 0012 "Open tenancy"), runs the contract's part of step 1 (the per-route body limit and the media type, below) and installs the outgoing response check on `ctx.response.response`.
2. Steps 2 to 5: authenticate (over the raw body for a signed identity), principal requirements, scopes outermost first, requirements in declared order.
3. Steps 6 to 8: input validation in one pass with the zod link's `input` validator, restricted input fields and sort keys, principal bindings. It stores the validated input in the request context.

Routes are added in the route table's order, which the generator sorts most specific first with the comparator every Node target shares (at each segment a static segment before a parameter, then fewer segments first), since AdonisJS matches the routes of one method in registration order. Added in contract order, `GET /tasks/{taskId}` before a `GET /tasks/search` action would route the action to the member operation, and the request path check below would not see it, since `/tasks/search` matches `/tasks/{taskId}`. The first middleware matches the raw path against the same table: a request AdonisJS routed to another operation than the raw path names answers the path's 404, so no controller runs under another operation's checks (ADR 0017 "Placement").

The route handler is generated too. It resolves the controller through the request's container resolver (`ctx.containerResolver.make`), so the controller's `@inject()` constructor injection works, calls the operation's method with the validated input, and runs step 10 on the result: undeclared status, projection of restricted output fields, stripping of undeclared fields, derived headers, the derived ETag and 304, and the write of the reply. The method's input is its argument, as the interface states; code that holds only the context reads the same value with the operation's accessor, `TasksAdonis.createTask.input(ctx)`, which validates nothing.

The app's own middleware run before the boundary: server middleware, then router middleware (the bodyparser), then a route group's middleware. Since the registration returns nothing, no app middleware runs between the boundary's and the handler. A bound handler, for this target's boot check, is the controller a `controllers` entry imports, carrying every method of its interface (below), as ADR 0012 "The boot check" lists for adonis.

Each generated middleware and the route handler catch the errors of their own steps and write the refusal themselves, since an error leaves the route pipeline for the app's exception handler (Exceptions on contract routes, below). Hook failures follow ADR 0012 "Failures inside hooks": bouncer's `E_AUTHORIZATION_FAILURE` thrown inside a decide hook answers the requirement's first declared denial code, and any other error a hook throws or rejects is a 500 with `onUnexpectedError` called.

Steps 1 to 8 and 10 run the shared request checks, copied into the generated tree with the generated header (ADR 0009 "What generated code depends on at run time"); this target adds one static placement file and its per-api module.

### The reply path

Every reply the boundary writes goes through the shared writer on the Node response (`res.statusCode`, `res.setHeader`, `res.end`), as ADR 0016 "The reply path" states: one path for a 2xx among several, the derived 304, an idempotent replay and every error. Adonis writes a response in `response.finish()` once the pipeline ends, and only while it is pending (`!headersSent && !writableFinished`); after the boundary's `res.end` it writes nothing, so no Adonis ETag or 304 comes with a boundary reply, and a value the route handler returns is ignored. Adonis's request-id header and any header the app set with `ctx.response.header()` (`@adonisjs/cors`, for one) are held by Adonis until `finish()` and therefore absent from boundary replies, as headers set before the shared writer are in ADR 0016.

### Exceptions on contract routes

AdonisJS runs a route's middleware and handler in one pipeline whose error handler is the app's exception handler. An error thrown by the controller or by a later middleware is handed to that handler at once; the earlier middleware's `await next()` then resolves normally. The boundary therefore catches where errors are thrown, never around `await next()`:

- The route handler catches what the controller throws. It answers the generated contract exceptions, and the framework refusals it maps by `status` and `code`, without importing their packages: `E_UNAUTHORIZED_ACCESS` (401, `@adonisjs/auth`), `E_AUTHORIZATION_FAILURE` (403, `@adonisjs/bouncer`) and `E_TOO_MANY_REQUESTS` (429, `@adonisjs/limiter`), each to the role of its status. A refusal whose status the operation does not declare is a 500. Every other error is rethrown to the app's exception handler, untouched, as ADR 0016 "Exceptions on contract routes" states for NestJS.
- Each generated middleware does the same for its own steps.

An app exception handler renders a contract error with the exported `renderContractError(ctx, error)`, which writes it in the api's format through the boundary's reply path and returns true. Without the boundary's request context (an error raised before the boundary, which `renderPreRoutingError` answers) it writes nothing and returns false. Non-contract routes are never touched: an app's own route on a path a contract template also matches (`PUT /v1/channels/{channelId}` where the contract serves only `GET`) keeps its own errors, since `renderPreRoutingError` leaves every request the router matched to a route other than the api's.

### The outgoing response check

The shared check of ADR 0016 "The outgoing response check", installed by the first middleware on that request's Node response only, enforces the contract on every reply of a contract route that the boundary did not write, the app's exception handler included: undeclared status, error body outside the api's format or with a code the operation does not list, a foreign ETag or 304, the `responses` mode and `bodyValidation`, and the completion of the idempotency record. Adonis passes its own headers as the second argument of `res.writeHead`, never through `res.setHeader`, so the check removes an ETag the boundary did not set from that argument as well as from the response. A streamed reply (`response.stream()` from the app's handler) passes through the same check, since Node calls `res.writeHead` before its first byte, as ADR 0016's spike showed for a piped stream; this spike did not run one.

The check covers what is written after the first route middleware. A server, router or group middleware that writes a reply without calling `next()` (`ctx.response.serviceUnavailable()` from a maintenance or IP filter) answers a contract route outside the contract, and that reply is not checked; only the errors such middleware throw reach `renderPreRoutingError`. Such middleware throw rather than write on contract routes.

The mode is a target option and a registration option, and an operation overrides it in the registration: `registerRoutes(router, { ..., responses: 'warn', operations: { createTask: { responses: 'strict', bodyValidation: true } } })`. Operations are named by the ADR 0007 `operation` role, unescaped, since ADR 0007 rule 4 leaves plain-object keys as they are: an operation named `registerRoutes` is the key `registerRoutes`. The order of precedence is operation, registration, then target option.

### Errors raised before the boundary

These reach only the app's exception handler, since they are raised before the boundary's first middleware: a body the JSON parser cannot parse (400), a body above the parser's limit (413), a top-level JSON scalar refused by the parser's strict mode (422), a refusal from server, router or group middleware (`E_UNAUTHORIZED_ACCESS` from an `auth()` group middleware, a limiter's `E_TOO_MANY_REQUESTS`, `@adonisjs/shield`'s CSRF refusal `E_BAD_CSRF_TOKEN`), and a path or method no route serves (`E_ROUTE_NOT_FOUND`). The bodyparser's errors come after the router matched, so `ctx.route` is set for them.

The target exports, per api, `renderPreRoutingError(error, ctx)`, which the app's `ExceptionHandler.handle` calls first and which returns whether it answered. It acts only when the boundary's request context is absent, which the spike confirmed: an error raised after the first middleware reaches the exception handler inside that context. Then, on a request whose raw path matches one of the api's contract path templates and that the router matched to one of the api's routes or to none, it renders the refusal in the api's format: the parser's 400 and its strict-mode 422 as the route's code of status 400, the 413 as the route's `payloadTooLarge` code with its limit, the mapped refusals above by role, `E_BAD_CSRF_TOKEN` (403, mapped by `status` and `code` without importing shield) as the route's `csrfInvalid` code (ADR 0012 "Native security layers"), and `E_ROUTE_NOT_FOUND`, a method the contract path does not serve, as the path's 404: the `notFound` code of an operation of the path, or a bare 404 with no body and no `onUnexpectedError` when none of them declares one (ADR 0016). A status the route does not declare is a 500. Any other error on a contract path (the bodyparser's unsupported-encoding 415, a plain error from server middleware) is a 500 in the api's format with `onUnexpectedError` called, fail closed, never Adonis's default rendering. On any other request it returns false and the app's handler goes on. An app with two apis calls each api's helper in turn. Without the helper, Adonis's default rendering answers these refusals on contract routes, with the right status and the wrong format.

### Raw body and decoded body

The AdonisJS bodyparser reads the body within its own limit, inflates it, decodes it as UTF-8 and keeps the decoded string, available as `request.raw()`, on JSON, form and raw requests. Neither AdonisJS 6 nor 7 keeps the bytes as a `Buffer`. A signed route therefore takes `Buffer.from(request.raw(), 'utf8')` as the raw bytes (ADR 0013 "Where the verification happens"); a later major that exposes the received bytes is used instead. The media type and size checks run on the raw bytes before the body is decoded, so a form body on a JSON route answers the route's 415, never a 400 for JSON it is not. On every contract route that takes a body, the first middleware, after the 415 check, reads whether the request announces body bytes (a non-zero `Content-Length` or a `Transfer-Encoding`): a body is announced while `request.raw()` is null only when the bodyparser did not read it, since its config exists whether or not its middleware is registered. That request answers 500 without running any later step, fail closed, and logs the operation id, the route and the fixes: register `@adonisjs/core/bodyparser_middleware` as router middleware and list the route's media type in `json.types`. Zero body bytes is no body, as on every Node target: a required body answers 400 `required`, and a signed route verifies the signature over zero bytes. The template signature header is parsed before the hook, as in ADR 0016.

The re-encoded bytes are the received bytes except in two cases, which both fail closed with 401 on the signature check: a body that starts with a UTF-8 byte-order mark, which the decoder strips, and a body with invalid UTF-8, whose bytes become U+FFFD. A sender that signs the bytes it sends never produces either for a JSON body.

The boundary decodes the JSON body itself, with `JSON.parse` on `request.raw()`, never `request.body()`: the bodyparser's `trimWhitespaces` and `convertEmptyStringsToNull` options, on in the default app, rewrite string values in the parsed body (AdonisJS 7 trims, AdonisJS 6 does not), and the boundary keeps its own decoder settings (ADR 0012 "The check order").

### Body limit, query and bounded values

- The bodyparser does the bounded read; its `json.limit` must be at least the largest route limit, which the target exports per api (`TasksAdonis.LARGEST_BODY_LIMIT`). The first middleware checks the route's own limit on the byte count of `request.raw()` re-encoded and answers 413; that count is the inflated size, which the route limit is about (ADR 0016 "Body limit, query and bounded values").
- Media type: a contract route with a JSON body refuses another `Content-Type` with 415 in the first middleware, since the bodyparser only skips it. A form or multipart body is read by the bodyparser before that 415, within its `form.limit` or `multipart.limit`, and with `multipart.autoProcess` on its files are written to the temporary directory first; the refusal comes after that read.
- `HEAD`: `router.get` also serves `HEAD`, which runs the `GET` operation; its reply goes out without a body (ADR 0016 "Errors raised before routing"). A path under one of the api's base paths that no route serves gets `E_ROUTE_NOT_FOUND`, which `renderPreRoutingError` answers with the api's 404.
- Path and query: decoded from the raw `request.request.url`, never from `ctx.params` or `request.qs()`, by the IR's wire form (ADR 0002 section 7), with ADR 0016's rules for a value that does not decode.
- `MAX_RENDERED_ISSUES`, `MAX_CHECKED_ERROR_BODY_BYTES`, the throttle bucket key and the idempotency key are those of ADR 0016.

### Handler results

As ADR 0016 "Handler results": the method returns its `output` or its `errors`, a success `{ status, body }` or a declared error `{ status, code, params }`, checked by the compiler, and a code the operation does not list is a 500 at run time. The thrown exception per error code comes right after the slice.

### Target options and names

`parseOptions` accepts `responses` (`strict`, the default, or `warn`) and `bodyValidation` (`false`, the default, or `true`), and refuses any other key by name. The registration takes the same two keys, and the same two per operation under `operations`.

The api's module is imported as a namespace (`import * as TasksAdonis from '.../tasks/adonis.js'`), with the api's `index.ts` re-exporting it (ADR 0007 "Amendment 2026-10-19: generated modules"). Its fixed exports are `registerRoutes`, `renderPreRoutingError`, `renderContractError`, `LARGEST_BODY_LIMIT` and `ROUTE_NAMES_BY_ACCESS`; they are shadowed names of ADR 0007 section 5 for the per-operation accessors, so an operation named `registerRoutes` gets `registerRoutes_`. `renderContractError` reads the api from the boundary's request context.

### Native security layers

ADR 0012 "Native security layers" is met with AdonisJS's own route names. Each route is named `<api>.<operation>`, and the api's module exports `ROUTE_NAMES_BY_ACCESS`, the route names per access kind (`public`, `optional`, `identity`, `signed`), so an app's own middleware skips public and optional-auth routes by `ctx.route.name` without a hand-kept list. Shield's CSRF refusal is mapped to `csrfInvalid` by `renderPreRoutingError`, above, since shield runs before the boundary.

### Registration

`registerRoutes(router, { controllers, hooks, responses?, bodyValidation?, operations? })` takes the hooks as one value: `authenticate`, `deciders`, `scopeResolvers`, `idempotencyStore` and the optional `onUnexpectedError`, shaped as in ADR 0016 "Registration". Hooks bound in the IoC container (ADR 0012 "Registration and per-right overrides") come later.

### The boot check

`registerRoutes` runs it when `start/routes.ts` is preloaded, before the HTTP server listens; it lists every problem at once with the operation id, the name and the fix, and throws, so the app does not start:

- an identity used by a bound operation without an authenticate hook, a right or rule without a decider, a scope without a resolver, an idempotent operation without an idempotency store, two deciders claiming one name;
- a resource interface without an entry in `controllers`;
- a second `registerRoutes` of one api on the app's router, since the replies written outside a request context report to one registration's hooks;
- the bodyparser setup, read through the public `app.config.get('bodyparser')`: a `json.limit` below `LARGEST_BODY_LIMIT` (parsed with Adonis's `string.bytes.parse`), a `json.encoding` other than UTF-8 (the re-encoded bytes and the 413 count assume it), a contract media type absent from `json.types`, a contract method absent from `allowedMethods`.

The framework-route check of ADR 0012 runs in `app.ready`, over the routes the router has committed (`toJSON`), and on AdonisJS 6 over its routes before the commit, leaving out the routes whose handler `registerRoutes` added. AdonisJS 7 commits the routes only when the HTTP server boots, so an app on 7 boots its server inside the `app.start` callback (`server.boot()`), as AdonisJS's own HTTP server process does; when the routes are not committed yet, the check refuses the start by name with that fix.

Two checks move to the request. The methods of a controller are read when its lazy import first loads, at its first request: a missing method answers 500 on every route of that controller, with a log listing each missing method; importing controllers at boot would undo Adonis's lazy controllers, and the `controllers` type already demands the interface at compile time. A route group prefix, which differs from the empty `mount` the slice allows, is detected by the first middleware when the request path differs from the contract path, and answers 500 with a log naming the group's `prefix`.

### What the generated code depends on

At run time: `@adonisjs/core` 6 or 7 (`@adonisjs/core/http`, its `services/app` and `helpers/string`), the zod link's runtime and, for types only, `@seampact/hooks` (ADR 0009). It never imports `@adonisjs/auth`, `@adonisjs/bouncer`, `@adonisjs/limiter` or `@seampact/signed-webhooks`, uses no decorators and no `#` subpath imports, and runs on Node 24, which AdonisJS 7 requires. The generated module reads `services/app` when it is imported, so the app imports it after the app is created, as a preloaded `start/routes.ts` does; imported earlier, the service is unset and the boot check stops the app with that fix.

### Refused by name or waiting

`generate` refuses by name, with the case's code and its fix, every input the slice does not serve ([A47](../decisions.md#a47)), and names its bringer:

- With no `validators` link, AdonisJS generates VineJS validators, strict input included (ADR 0012 "Target obligations"); a link always wins.
- Waiting for the target after the slice: the thrown exception per error code; `nativeDocs` and `frameworkDocs`; `hooks: vendored` ([A40](../decisions.md#a40)); `accessHooks: false` and `access: native` ([A42](../decisions.md#a42)); per-right overrides, record loaders, `decideMany` and decider params checks; hooks bound in the IoC container; form, multipart, download and redirect bodies (`request.file()`, `response.download()`, [A39](../decisions.md#a39)); a request body whose schema is not an object or an array, which the parser's default strict mode refuses before routing; `api.wire.urls: absolute`; handler groupings other than ADR 0007's `handlers` default.
- Waiting for the server entry keys of the CLI: `mount`, with the boot check of the installed hooks range.
- Every IR form absent from the reference contract's golden IRs is refused until a consumer needs it. The shared boundary's `generate` warnings for forms it leaves to the handler apply unchanged (ADR 0016).

### The spike

A spike, run and not kept, booted a minimal app in process on Node 24.21 with AdonisJS 7.6.0 (`@adonisjs/http-server` 9.3.1, `@adonisjs/bodyparser` 11.0.4), then ran the same app source on AdonisJS 6.21.0 (`@adonisjs/http-server` 7.8.1, `@adonisjs/bodyparser` 10.1.5). It created the app with `Ignitor.createApp('web')`, passed `adonisrc.ts` through `rcContents` (the RC loader imports `adonisrc.js`, which a TypeScript app run without a loader lacks), and served `server.handle` on its own Node server. Its boundary was the placement above with a reduced outgoing check. Both majors gave the same wire results:

| Case | Result |
|---|---|
| Boundary reply 202 with its own ETag, `etag: true` in the app's http config | 202, the boundary's ETag, no Adonis ETag; the handler's returned value ignored |
| Boundary 304 | 304 with the boundary's ETag |
| Contract exception thrown by the controller | caught by the route handler, 409 in the format; the first middleware's `await next()` resolved without it |
| Bouncer-style `E_AUTHORIZATION_FAILURE` thrown by the controller | mapped by the route handler to 403 |
| Plain error from the controller, app handler answers an undeclared 418 | the outgoing check saw the handler's reply and replaced it with a 500 |
| Same, app handler answers a declared 404 in the format | passed |
| Lazy `ctx.response.status(201).send()` on a contract route | undeclared, replaced with a 500 |
| Lazy `send()` with a declared 200 | passed, Adonis's ETag removed from the `writeHead` argument |
| An undeclared 429 thrown by a route middleware after the boundary's | reached the app handler inside the boundary context, so the pre-routing helper declined; the check replaced the reply with a 500 |
| `auth()`-style 401 from a group middleware | raised before the boundary, rendered by the pre-routing helper with no boundary context |
| Non-contract route | untouched, Adonis's ETag kept |
| Signed route, valid HMAC over `Buffer.from(request.raw(), 'utf8')` | 200 |
| Signed route with a byte-order mark, or invalid UTF-8 | 401: the re-encoded bytes differ |
| `{"name":"  padded  ","empty":""}` | `request.raw()` kept it; `request.body()` gave `null` for `empty` on both, and trimmed `name` on 7 only |
| Malformed JSON, top-level scalar | 400 and 422 raised before route middleware, with `ctx.route` set |
| `DELETE` on a contract path | `E_ROUTE_NOT_FOUND`, `ctx.route` unset, rendered by the helper |
| Boot read of `app.config.get('bodyparser.json')` from `start/routes.ts` | `limit`, `types` and `strict` read, defaults filled |

The only difference between the majors outside the boundary was the app setup: AdonisJS 7 refuses to boot without `config/encryption.ts`, a file AdonisJS 6 cannot load. The consumer therefore keeps one overlay file per major.

## Consequences

- An app keeps its `start/kernel.ts`, its exception handler and its own routes; it calls `registerRoutes` from `start/routes.ts` and the pre-routing helper from its exception handler.
- The controller is a plain class implementing the generated interface; it receives the validated input and never touches `ctx.response`, since the boundary writes every reply on contract routes.
- App middleware that should run on contract routes go in server, router or group middleware, all of which run before the boundary. Such middleware throw rather than write: a reply they write is not checked.
- Errors the controller throws outside the contract reach the app's exception handler unchanged; under `strict`, a reply of the handler's outside the contract becomes a 500, and under `warn` a logged violation.
- A signed body with a byte-order mark or invalid UTF-8 fails its signature, since AdonisJS keeps only the decoded body.
- AdonisJS 6 and 7 get the same generated code, and the consumer runs on both.

## Traceability

- FRs: FR-5 (the check order), FR-14 (a case refused by name), FR-35 (the shared suite this boundary will pass); amendments A15, A36, A39, A40, A42, A47.
- ADRs: 0007 (names), 0009 (links, run-time dependencies), 0012 (placement and target obligations), 0013 (raw body and signature header), 0016 (the shared obligations).
- Proof in the development phase: the review of this ADR, the spike above, and the slice's end-to-end gate on the AdonisJS consumer.

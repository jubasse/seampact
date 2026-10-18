# ADR 0016: The NestJS server target

Status: accepted

## Context

ADR 0012 fixes what every server target generates around the developer's controller and lists, under "Target obligations", what each target's own ADR must state. `@seampact/codegen-nestjs` is the first server target built, for the end-to-end slice ([A47](../decisions.md#a47)): it generates, for each api of the app config, the boundary around the developer's `@Controller()` classes, validating with the zod link (ADR 0009 "The provider seam").

NestJS is a layer over an HTTP platform, Express by default, and three of its behaviours shape the placement. A route has a fixed status that NestJS re-applies when it writes the reply, so an interceptor cannot choose the status. Exceptions go to one filter each, chosen by scope. And everything that happens before routing (body parsing, an unknown route) is outside every route-scoped mechanism. This ADR states where each step of ADR 0012's check order runs in NestJS, how each obligation is met, and what the target refuses by name or leaves for later. The Fastify and Express targets reuse the same request checks through `@seampact/codegen-core` and cite this ADR for the shared obligations instead of restating them.

## Options

- Platform under NestJS: Express only in the slice, or Express and Fastify together. Choice: Express, NestJS's default; Fastify under NestJS comes right after the slice, since its raw-body and reply handling differ and would double the riskiest glue.
- Reply path: the boundary writes status, headers and body itself, or it hands a value to NestJS and turns off Express's ETag with `app.set('etag', false)`. Choice: the boundary writes the reply; turning ETags off app-wide would change the app's own routes ([A36](../decisions.md#a36)), and NestJS would still re-apply the route status.
- Raw body for signed routes: a boot check that refuses to start without `rawBody: true`, a generated startup helper, or a per-request check with documented setups. Choice: the per-request check, fail closed, and an opt-in generated `verify` function; NestJS exposes no public way to read the parser setup at boot, and the app keeps its own `main.ts` (A36).
- Handler refusals: a typed returned error, a typed thrown exception, or both. Choice: both (ADR 0012 "Errors the handler answers"), the returned error in the slice and the thrown exception right after it.
- Exceptions on contract routes: a seampact filter that catches every exception there, or one that catches only seampact's own while the app's filters handle the rest. Choice: the narrow filter, since NestJS gives each exception to exactly one filter and a catch-all would hide the app's own; the contract is then enforced on the outgoing response, whoever wrote it.

## Decisions

### Placement

The developer writes the controller and implements the generated interface of each resource (ADR 0007 `handlers`), as ADR 0012 "Your controller, the generated utilities around it" shows: `@UpdateTask() update(@UpdateTaskInput() input: UpdateTaskRequest)`. Codegen emits, per api, under the target entry's `out`:

- A module middleware, bound to the routes of the generated route table, that opens the request context (`AsyncLocalStorage`, ADR 0012 "Open tenancy") and runs the step 1 checks that belong to the contract (the per-route body limit and the media type, below) and installs the outgoing response check (below). It writes its refusals itself in the api's error format, since an exception thrown by a middleware reaches only global filters.
- Per operation, a composite method decorator built with `applyDecorators`: the verb and the full contract path with `Version(VERSION_NEUTRAL)`, `SetMetadata` with the operation id and its access kind (the route metadata a native guard reads through `Reflector`, ADR 0012 "Native security layers"), `UseGuards` with the seampact guard, `UseInterceptors` with the seampact interceptor, `UseFilters` with the seampact filter, and the response mark of the reply path (below). It carries no `HttpCode`: the reply path writes every status.
- The guard runs steps 2 to 5: authenticate (over the raw body for a signed identity), principal requirements, scopes outermost first, requirements in declared order. Guards run after middleware and before interceptors and pipes.
- The interceptor runs steps 6 to 8 before the handler (input validation in one pass with the zod link's `input` validator, restricted input fields and sort keys, principal bindings) and step 10 after it: undeclared status, projection of restricted output fields, stripping of undeclared fields from the IR shape, derived headers, the derived ETag and 304, and the write of the reply. It stores the validated input on the request; it never uses the app's global `ValidationPipe` (ADR 0012 "The check order").
- Per operation, a param decorator made with `createParamDecorator` that only reads the input the interceptor stored. It validates nothing.
- The filter of the api's error format, the dynamic module registering the hooks, and the boot check (below).

Steps 1 to 8 and 10 run the framework-neutral request checks of `@seampact/codegen-core/node-server`, copied into the generated tree with the generated header (ADR 0009 "What generated code depends on at run time"); this target writes only their NestJS placement.

### The reply path

Every contract route's reply is written by the boundary with `res.statusCode`, `res.setHeader` and `res.end`, never `res.json` or `res.send`: one path for a 2xx among several, the derived 304, an idempotent replay (written without calling the handler) and every error. Express computes its weak ETag and its 304 inside `res.send`, so a reply written with `res.end` gets neither, and the app's own routes keep Express's settings. ADR 0012's step 10 obligation for nestjs is met by this one rule.

NestJS still calls its own reply after the interceptor's observable completes, unless the route takes the raw response. The composite therefore applies NestJS's public `Res()` parameter decorator at the first index after the method's declared parameters: NestJS then treats the response as handled and never writes it, and the handler receives the response as an extra trailing argument its interface does not declare. A result an app's global interceptor maps on a contract route is discarded, since the contract's projection is the reply.

The spike that backs this, run on NestJS 12.1.3, `@nestjs/platform-express` 12.1.3, Express 5.2.1 and Node 24.21, and not kept, compared three ways for an interceptor that writes the reply:

| Way | Wire result | After the reply |
|---|---|---|
| write, then emit a value | right status, headers and body | NestJS replies again on the ended response; on the 304, Express's `res.send` finds the request fresh and throws `ERR_HTTP_HEADERS_SENT` into the filter |
| write, then complete without a value | right status, headers and body | every reply raises an `EmptyError` into the filter |
| mark the response with `Res()`, write, then emit | right status, headers and body | nothing: no second reply, no error |

With the marked way, a GET answered 200 with the boundary's strong ETag and no Express ETag, a matching `If-None-Match` answered the boundary's 304, a POST whose NestJS default is 201 answered the handler's 202, a replay answered 201 with the replay header without calling the handler, and a guard refusal answered 401 through the filter. On the same app, a route of the app's own kept Express's weak ETag and its 304.

### Exceptions on contract routes

NestJS hands each exception to exactly one filter, the first whose `@Catch()` types match, looking at the route's filters, then the controller's, then the global ones (the last registered first). A route-scoped filter that caught everything would therefore hide the app's own filters on every contract route. The seampact filter on the composite catches only the generated contract exceptions and the framework refusals it maps; every other exception follows NestJS's own path through the app's method, controller and global filters, untouched. Non-contract routes are never touched.

The framework refusals mapped at step 1: `UnauthorizedException`, `ForbiddenException`, and a 429 `HttpException` such as `@nestjs/throttler`'s `ThrottlerException` (matched by status, so the generated code does not import the throttler), each to the role of its status; a refusal whose status the operation does not declare is a 500, as for a hook (ADR 0012 "Failures inside hooks"). An app filter renders a contract error with the exported `renderContractError(host, error)`, which writes it in the api's format through the boundary's reply path.

### The outgoing response check

Since an app filter may answer anything, the contract is enforced on the outgoing response of each contract route, whoever wrote it. The module middleware installs the check on that request's response object only, around `writeHead`, `write` and `end`; Node calls `writeHead` itself before the first byte of any reply, so `res.send`, `res.json` and a piped stream all pass through it. Replies the boundary writes itself skip it.

- A declared success status passes at once, chunk by chunk, a stream included.
- An undeclared status is a violation as soon as the status is known; the writer's chunks are not kept.
- A declared error status is held until the end, up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536`, and its body must be in the api's error format with a code the operation lists; a longer body is a violation.

A violation follows the `responses` mode. Under `strict`, the default, the reply is replaced by a 500 in the api's format and the optional `onUnexpectedError(exceptionOrReply, context)` hook is called, for logging and error tracking; a failure inside the hook is logged and the 500 still goes out. Under `warn`, the reply goes out as written and the violation is logged with the operation id. The mode is a target option, overridden per controller or per method by a generated decorator (`@TasksResponses('warn')` for the `tasks` api); the seampact guard reads it through `Reflector` and records it on the request, so a reply written before that guard runs (an app global guard's refusal) follows the target option. The target option `bodyValidation`, off by default and meant for development and tests, also holds JSON success replies and validates them with the zod link's output validators; a body that fails is a violation.

An idempotent operation's record is completed with the reply that went out, after the check: the boundary's own reply, a contract error from the seampact filter, or a declared error an app filter wrote; it is abandoned after a 500. The check thereby sees the stored error the interceptor cannot (ADR 0012 "Target obligations").

A second spike, on the same versions and not kept, installed such a check from a module middleware. A controller-scoped app filter's declared 404 in the api's format passed; its undeclared 418 became a 500 with the hook called, and passed with a logged violation on a controller marked `warn`. A global filter registered with `useGlobalFilters` answering a declared 409 as plain JSON became a 500; its 409 in the api's format passed with a listed code and became a 500 with an unlisted one. A `StreamableFile` of three chunks 150 ms apart reached the client as three chunks at the same pace, and the same stream with an undeclared 206 became a 500. A non-contract route was untouched. The check has three limits: a writer that bypasses the response object (writing on `res.socket`) is not seen; a refusal raised before routing comes before the middleware and goes through the exported global filter below; and `res.headersSent` reads false while an error body is held.

### Errors raised before routing

These reach only the global filters: a body the platform's JSON parser cannot parse (400), a body above the app-wide parser limit (413), a path no route serves (404). The target exports a global filter class and a helper for them: on a request that matches a contract route's path template, they render the refusal in that api's format; on any other request, the filter hands the exception to NestJS's default `BaseExceptionFilter` and the helper returns that it did nothing. The app registers the exported filter, or calls the helper first in its own global filter. Without either, NestJS's default JSON body answers these refusals on contract routes, with the right status and the wrong format; the README's NestJS setup shows both forms.

### Target options

`parseOptions` accepts `responses` (`strict`, the default, or `warn`) and `bodyValidation` (`false`, the default, or `true`), and refuses any other key by name.

### Raw body

A signed identity's authenticate hook needs the raw bytes (ADR 0013 "Where the verification happens"). There is no boot check on the raw body. The guard checks, on each request to a signed route, that the raw bytes are present as a `Buffer` on `req.rawBody`; when they are not, it answers 500 without calling the hook, fail closed, and logs the operation id, the route and both fixes below. The template signature header is parsed before the hook, and a malformed or missing header answers 401 without calling it (ADR 0013 "Test vectors" S10 and S11).

Three setups are documented, each keeping the app's own startup code:

1. `NestFactory.create(AppModule, { rawBody: true })`, with `app.useBodyParser('json', { limit })`: NestJS keeps the raw bytes of every request.
2. `NestFactory.create(AppModule)` with `rawBody` off, and `app.useBodyParser('json', { limit, verify: keepRawBodyForSignedRoutes })`: the generated opt-in `verify` function keeps the raw bytes only on the api's signed routes, and records the parsed byte count on every contract route for the body limit. NestJS 12 replaces any `verify` option of `useBodyParser` with its own when `rawBody` is on, so this setup needs `rawBody` off. An app that serves two apis with signed routes calls each api's function from one `verify`.
3. `bodyParser: false` and the app's own parser, which sets `req.rawBody` to the bytes as received on signed routes and re-serializes nothing before.

### Body limit, query and bounded values

- The app-wide JSON parser does the bounded read; its limit must be at least the largest route limit, which the target exports per api as a generated constant (`TASKS_LARGEST_BODY_LIMIT` for the `tasks` api) for the setups above. The module middleware then checks the route's own limit, from `Content-Length` and otherwise from the raw body or the recorded byte count, and answers 413. A request with a body whose length none of these gives (a chunked body under the app's own parser) answers 500 in the slice, fail closed, with a log naming the setups; accepting it within the parser limit is a follow-up. A parser 413 whose limit is below the route's limit is a setup error, not the contract's refusal: the exported transport filter and helper answer it with 500 and a log naming the generated constant.
- Media type: a contract route with a JSON body refuses another `Content-Type` with 415 in the module middleware, since the JSON parser only skips it.
- Query: decoded from the raw query string of `req.originalUrl` by the IR's wire form (ADR 0002 section 7), never from `req.query`. Path, query and header strings are decoded before the validator; a value that does not decode stays the raw string, so the validator reports it with every other issue in step 6's one pass, and the validator never coerces.
- The issues list rendered into error params is bounded by `MAX_RENDERED_ISSUES = 100`.
- The throttle bucket key and the idempotency key are fixed-size SHA-256 digests. The idempotency key digests the api id, the operation id, the identity id, a digest of the validated principal (none for an anonymous caller) and the client's key, never the credentials (ADR 0012 "Target obligations").

### Handler results

The generated handler interface takes the operation's `input` from the types link and returns its `output` or its `errors` (ADR 0007 roles): a success `{ status, body }` or a declared error `{ status, code, params }`, checked by the compiler. A code the operation does not list is a type error, and at run time a 500. The generated exception per code (`TasksLockedError`), thrown by the handler or a hook, comes right after the slice and goes through the same filter.

### Registration

Each api gets one dynamic module, named by ADR 0007 (`TasksSeampactModule.forRoot({ authenticate, deciders, scopeResolvers, idempotencyStore, onUnexpectedError })`); `onUnexpectedError` is optional. Hooks are NestJS providers registered under explicit injection tokens: an authenticate hook per identity, or one serving several; a decider by a list of right and rule names, or all; a scope resolver per scope kind, or one serving several. Two deciders claiming one name is a boot error, and no default hook exists (ADR 0012 "Registration and per-right overrides"). The api's name prefixes its module, providers, tokens, route table and exported constants and helpers, so two apis in one app never collide, and each api's boot check covers its own operations.

### The boot check

The module runs it in `onApplicationBootstrap`, before the app accepts a request, through NestJS's public `DiscoveryService` and `Reflector`; it lists every problem at once with the operation id, the name and the fix, and throws, so the app does not start:

- an identity used by a bound operation without an authenticate hook, a right or rule without a decider, a scope without a resolver, an idempotent operation without an idempotency store;
- two deciders claiming one name;
- a contract operation without a bound handler: no controller method carries its composite;
- a platform other than Express (`HttpAdapterHost`).

Two checks of ADR 0012's list move to the request, since NestJS 12 exposes no public read of them at boot (its `ApplicationConfig` is not injectable, and Express keeps the parser limit inside the parser): a parser limit below a route's limit is answered as above, and a NestJS global prefix, which differs from the empty `mount` the slice allows, is detected by the module middleware when the request path differs from the contract path, and answers 500 with a log naming `setGlobalPrefix` and its `exclude` option.

### What the generated code depends on

At run time: `@nestjs/common`, `@nestjs/core`, `rxjs`, the zod link's runtime and, for types only, `@seampact/hooks` (ADR 0009). It uses explicit injection tokens with `@Inject`, never `emitDecoratorMetadata`, so any transpiler that supports NestJS's legacy decorators runs it. It never imports `@seampact/signed-webhooks`: the app's authenticate hook calls it.

### Refused by name or waiting

`generate` refuses by name, with the case's code and its fix, every input the slice does not serve ([A47](../decisions.md#a47)); each comes with the bringer named:

- Waiting for the target after the slice: the NestJS Fastify platform (the boot check refuses a non-Express adapter); the thrown exception per error code; `nativeDocs` and `frameworkDocs`; the `class-validator` link style (ADR 0009); `hooks: vendored` ([A40](../decisions.md#a40)); `accessHooks: false` and `access: native` ([A42](../decisions.md#a42)); per-right overrides, record loaders, `decideMany` and decider params checks; form, multipart, download and redirect bodies ([A39](../decisions.md#a39)); `api.wire.urls: absolute`; handler groupings other than ADR 0007's `handlers` default.
- Waiting for the server entry keys of the CLI: `mount` and `frameworkRoutes`, with the boot checks of framework routes and of the installed hooks range.
- Every IR form absent from the reference contract's golden IRs is refused until a consumer needs it.

## Consequences

- An app keeps its `main.ts`, its global pipes, guards, interceptors and filters; on contract routes the boundary's checks and reply win, and its own routes are unchanged, Express ETags included.
- Every reply on a contract route is written by generated code, so NestJS features that write the reply (`@Header`, `@Redirect`, `@Render`, a global serializer interceptor) do nothing there.
- App filters keep working on contract routes; under `strict`, a reply of theirs outside the contract becomes a 500, and under `warn` a logged violation.
- Refusals raised before routing are in the api's format only when the app registers the exported global filter or calls its helper; the README's NestJS setup shows both.
- A raw-body or parser-limit setup error answers 500 on the routes it affects, with a log naming the fix, instead of refusing to start.
- The Fastify and Express targets reuse the shared request checks and cite this ADR for the obligations; only their placement is new.

## Traceability

- FRs: FR-5 (the check order), FR-14 (a case refused by name), FR-35 (the shared suite this boundary will pass); amendments A30, A36, A39, A40, A41, A42, A47.
- ADRs: 0007 (names), 0009 (links, run-time dependencies), 0012 (placement and target obligations), 0013 (raw body and signature header).
- Proof in the development phase: the review of this ADR, the spike above, and the slice's end-to-end gate on the NestJS consumer.

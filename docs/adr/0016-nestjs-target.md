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

The developer writes the controller and implements the generated interface of each resource (ADR 0007 `handlers`), as ADR 0012 "Your controller, the generated utilities around it" shows: `@TasksNest.updateTask() update(@TasksNest.updateTask.input() input: Tasks.UpdateTaskInput)`, with `import * as TasksNest from '.../tasks/nestjs'` and `import type * as Tasks from '.../tasks/types'`. Codegen emits, per api, under the target entry's `out`:

- A module middleware, bound to the routes of the generated route table, that opens the request context (`AsyncLocalStorage`, ADR 0012 "Open tenancy") and runs the step 1 checks that belong to the contract (the per-route body limit and the media type, below) and installs the outgoing response check (below). It writes its refusals itself in the api's error format, since an exception thrown by a middleware reaches only global filters.
- Per operation, a composite method decorator built with `applyDecorators`: the verb and the full contract path with `Version(VERSION_NEUTRAL)`, `SetMetadata` with the operation id and its access kind (the route metadata a native guard reads through `Reflector`, ADR 0012 "Native security layers"), `UseGuards` with the seampact guard, `UseInterceptors` with the seampact interceptor, `UseFilters` with the seampact filter, and the response mark of the reply path (below). It carries no `HttpCode`: the reply path writes every status.
- The guard runs steps 2 to 5: authenticate (over the raw body for a signed identity), principal requirements, scopes outermost first, requirements in declared order. Guards run after middleware and before interceptors and pipes.
- The guard and the interceptor wrap every hook call (ADR 0012 "Failures inside hooks"): a NestJS denial (`ForbiddenException`, `UnauthorizedException`) thrown inside a decide hook answers the requirement's first declared denial code, and any other exception thrown or rejected by a hook is a 500 with `onUnexpectedError` called; both leave as generated contract exceptions, so the seampact filter answers them and no app filter sees a hook's error.
- The interceptor runs steps 6 to 8 before the handler (input validation in one pass with the zod link's `input` validator, restricted input fields and sort keys, principal bindings) and step 10 after it: undeclared status, projection of restricted output fields, stripping of undeclared fields from the IR shape, derived headers, the derived ETag and 304, and the write of the reply. It stores the validated input on the request; it never uses the app's global `ValidationPipe` (ADR 0012 "The check order").
- Per operation, a param decorator made with `createParamDecorator` that only reads the input the interceptor stored. It validates nothing.
- The filter of the api's error format, the dynamic module registering the hooks, and the boot check (below).

The two per-operation decorators are named by the operation (ADR 0007 `operation` role): the composite is the operation's name, `createTask()`, and the param decorator is its `input` property, `createTask.input()`. They live in this target's module of the api, apart from the types link's module, so a declared schema of the same words (`CreateTask` in the reference contract) or the `CreateTaskInput` type never shares their scope (ADR 0007 "Amendment 2026-10-19: generated modules"). Inside this target's output, its fixed exports (below) are shadowed names of ADR 0007 section 5 for the operation decorators, so an operation named `responses` gets `responses_()`.

Route order is the app's: NestJS on Express registers a controller's routes in the order its methods are declared and matches the first, so a parameter route declared before a static sibling of the same method (`GET /tasks/:taskId` before `GET /tasks/search`) shadows it, and the member operation runs its checks on the action's requests. The composite cannot reorder them; the developer declares the static route's method first.

Steps 1 to 8 and 10 run the framework-neutral request checks of `@seampact/codegen-core/node-server`, copied into the generated tree with the generated header (ADR 0009 "What generated code depends on at run time"); this target writes only their NestJS placement.

### The reply path

Every contract route's reply is written by the boundary with `res.statusCode`, `res.setHeader` and `res.end`, never `res.json` or `res.send`: one path for a 2xx among several, the derived 304, an idempotent replay (written without calling the handler) and every error. Express computes its weak ETag and its 304 inside `res.send`, so a reply written with `res.end` gets neither, and the app's own routes keep Express's settings. ADR 0012's step 10 obligation for nestjs is met by this one rule.

NestJS still calls its own reply after the interceptor's observable completes, unless the route takes the raw response. The composite therefore applies NestJS's public `Res()` parameter decorator at the first index after both the method's declared parameters (`method.length`) and its highest decorated parameter, since `length` stops at a parameter with a default value or a rest parameter: NestJS then treats the response as handled and never writes it, and the handler receives the response as an extra trailing argument its interface does not declare. A result an app's global interceptor maps on a contract route is discarded, since the contract's projection is the reply. A global interceptor that answers without calling `next.handle()` (`@nestjs/cache-manager`'s `CacheInterceptor` on a hit) leaves a contract route with no reply at all, since the seampact interceptor never runs and NestJS treats the response as handled; no public hook lets the boundary detect it. The target exports `isContractRoute(context)`, true when the handler carries an operation's composite metadata, for such an interceptor to call `next.handle()` at once on contract routes.

The spike that backs this, run on NestJS 12.1.3, `@nestjs/platform-express` 12.1.3, Express 5.2.1 and Node 24.21, and not kept, compared three ways for an interceptor that writes the reply:

| Way | Wire result | After the reply |
|---|---|---|
| write, then emit a value | right status, headers and body | NestJS replies again on the ended response; on the 304, Express's `res.send` finds the request fresh and throws `ERR_HTTP_HEADERS_SENT` into the filter |
| write, then complete without a value | right status, headers and body | every reply raises an `EmptyError` into the filter |
| mark the response with `Res()`, write, then emit | right status, headers and body | nothing: no second reply, no error |

With the marked way, a GET answered 200 with the boundary's strong ETag and no Express ETag, a matching `If-None-Match` answered the boundary's 304, a POST whose NestJS default is 201 answered the handler's 202, a replay answered 201 with the replay header without calling the handler, and a guard refusal answered 401 through the filter. On the same app, a route of the app's own kept Express's weak ETag and its 304.

### Exceptions on contract routes

NestJS hands each exception to exactly one filter, the first whose `@Catch()` types match, looking at the route's filters, then the controller's, then the global ones (the last registered first). A route-scoped filter that caught everything would therefore hide the app's own filters on every contract route. The seampact filter on the composite catches only the generated contract exceptions and the framework refusals it maps; every other exception follows NestJS's own path through the app's method, controller and global filters, untouched. Non-contract routes are never touched.

The framework refusals mapped at step 1: `UnauthorizedException`, `ForbiddenException`, and a 429 `HttpException` such as `@nestjs/throttler`'s `ThrottlerException`, each to the role of its status. NestJS picks a filter by its `@Catch()` types and a picked filter cannot decline, so the seampact filter never lists `HttpException` itself, which would take every handler's `NotFoundException` from the app's filters: it lists the generated contract exceptions, the two classes above, and a generated class whose `static [Symbol.hasInstance]` matches an `HttpException` of status 429, so the generated code does not import the throttler. These mappings apply only to refusals raised outside seampact's hooks (an app guard, the throttler); a refusal whose status the operation does not declare is a 500, as for a hook (ADR 0012 "Failures inside hooks"). An app filter renders a contract error with the exported `renderContractError(host, error)`, which writes it in the api's format through the boundary's reply path.

### The outgoing response check

Since an app filter may answer anything, the contract is enforced on the outgoing response of each contract route, whoever wrote it. The module middleware installs the check on that request's response object only, around `writeHead`, `write` and `end`; Node calls `writeHead` itself before the first byte of any reply, so `res.send`, `res.json` and a piped stream all pass through it. Replies the boundary writes itself skip the contract checks; they still complete the idempotency record below. Every reply on a contract route keeps the headers the app's middleware set (CORS, security headers, a throttler's `Retry-After`): the boundary replaces only the body headers (`Content-Type`, `Content-Length`, `Content-Encoding`, `ETag`) and the names its reply writes, and merges `Vary`. Headers passed as `writeHead`'s argument are checked as those set with `setHeader`.

Express's weak `ETag` and its 304 come with every `res.send` and `res.json`, an app filter's included, and step 10 excludes both from contract routes (ADR 0012 "Target obligations"). The check therefore removes, before the head goes out, an `ETag` header the boundary did not set, whatever the status, and treats a 304 the boundary did not write as a violation.

- A declared success status passes at once, chunk by chunk, a stream included.
- An undeclared status is a violation as soon as the status is known; the writer's chunks are not kept.
- A declared error status is held until the end, up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536`, and its body must be in the api's error format with a code the operation lists; a longer body is a violation. A body in `gzip`, `deflate` or `br` (compression middleware) is decoded first, the cap applying to the decoded bytes; any other content encoding is a violation.

A violation follows the `responses` mode. Under `strict`, the default, the reply is replaced by a 500 in the api's format and the optional `onUnexpectedError(exceptionOrReply, context)` hook is called with the exception behind the reply when the boundary knows it, else the violating reply (`{ status, headers, body, violation }`), for logging and error tracking; without the hook the violation is logged; a failure inside the hook is logged and the 500 still goes out. Under `warn`, the reply goes out as written and the violation is logged once with the operation id. The mode is a target option, overridden per controller or per method by a generated decorator (`@TasksNest.responses('warn')` for the `tasks` api); the seampact guard reads it through `Reflector` and records it on the request, so a reply written before that guard runs (an app global guard's refusal) follows the target option. The target option `bodyValidation`, off by default and meant for development and tests, also holds JSON success replies and validates them with the zod link's output validators; a body that fails is a violation.

An idempotent operation's record is completed with the reply that went out, after the check: the boundary's own reply, a contract error from the seampact filter, or a declared error an app filter wrote; it is abandoned after a 500. Under `warn`, a violating reply that goes out is stored and replayed as written, since the client already received it; a 5xx abandons the record as a 500 does. The check thereby sees the stored error the interceptor cannot (ADR 0012 "Target obligations").

A second spike, on the same versions and not kept, installed such a check from a module middleware. A controller-scoped app filter's declared 404 in the api's format passed; its undeclared 418 became a 500 with the hook called, and passed with a logged violation on a controller marked `warn`. A global filter registered with `useGlobalFilters` answering a declared 409 as plain JSON became a 500; its 409 in the api's format passed with a listed code and became a 500 with an unlisted one. A `StreamableFile` of three chunks 150 ms apart reached the client as three chunks at the same pace, and the same stream with an undeclared 206 became a 500. A non-contract route was untouched. The check has three limits: a writer that bypasses the response object (writing on `res.socket`) is not seen; a refusal raised before routing comes before the middleware and goes through the exported global filter below; and `res.headersSent` reads false while an error body is held. A 2xx written by anyone but the boundary (an app filter) is checked for its status, and for its body only under `bodyValidation`, but neither projected nor stripped, so restricted output fields are not removed from it, and `bodyValidation` does not check field rights.

### Errors raised before routing

These reach only the global filters: a body the platform's JSON parser cannot parse (400), a body above the app-wide parser limit (413), a path no route serves (404). The target exports, per api, a global filter instance and a helper for them (`preRoutingFilter`, `renderPreRoutingError(exception, host)`). They act only when the boundary's request context is absent, since the module middleware opens it on every contract route before any handler-side exception can be thrown; then, on a request that matches a contract route's path template, they render the refusal in that api's format. On any other request, the filter hands the exception to NestJS's default `BaseExceptionFilter` and the helper returns that it did nothing. NestJS tries the last registered global filter first and gives the exception to that one alone, so the exported filter suits an app without a global filter of its own; an app with one, or with two apis, calls each api's helper first in its own global filter. Without either, NestJS's default JSON body answers these refusals on contract routes, with the right status and the wrong format; the README's NestJS setup shows both forms. For two apis, one `@Catch()` filter extending `BaseExceptionFilter`, built with `app.getHttpAdapter()`, tries each api's `renderPreRoutingError(exception, host)` in turn and calls `super.catch(exception, host)` when none acts. A method the path does not serve (`PUT` on a task) is a 404 NestJS raises before routing, so the filter answers it with that path's `notFound` code: the contract has no 405. The filter delegates to `BaseExceptionFilter` with the HTTP adapter the api's module records when it starts, so the app's own routes keep NestJS's statuses and its error log; an unclaimed exception on a contract route is also kept for `onUnexpectedError` when the reply NestJS writes for it violates the contract. A pre-routing 500 (a parser limit below a route's limit) calls `onUnexpectedError` too.

### Target options

`parseOptions` accepts `responses` (`strict`, the default, or `warn`) and `bodyValidation` (`false`, the default, or `true`), and refuses any other key by name.

### Raw body

A signed identity's authenticate hook needs the raw bytes (ADR 0013 "Where the verification happens"). There is no boot check on the raw body. The guard checks, on each request to a signed route, that the raw bytes are present as a `Buffer` on `req.rawBody`; when they are not, it answers 500 without calling the hook, fail closed, and logs the operation id, the route and both fixes below. The template signature header is parsed before the hook, and a malformed or missing header answers 401 without calling it (ADR 0013 "Test vectors" S10 and S11).

Three setups are documented, each keeping the app's own startup code:

1. `NestFactory.create(AppModule, { rawBody: true })`, with `app.useBodyParser('json', { limit })`: NestJS keeps the raw bytes of every request.
2. `NestFactory.create(AppModule)` with `rawBody` off, and `app.useBodyParser('json', { limit, verify: TasksNest.keepRawBody })`: the generated opt-in `verify` function keeps the raw bytes only on the api's signed routes, and records the parsed byte count on every contract route for the body limit. NestJS 12 replaces any `verify` option of `useBodyParser` with its own when `rawBody` is on, so this setup needs `rawBody` off. An app that serves two apis with signed routes calls each api's function from one `verify`.
3. `bodyParser: false` and the app's own parser, which sets `req.rawBody` to the bytes as received on signed routes and re-serializes nothing before.

Setups 1 and 2 pass `strict: false` to `useBodyParser('json', ...)`, as ADR 0018 does on its route parsers: a JSON scalar body then parses, and a value of the wrong type is a step 6 issue (ADR 0012 step 1), not the parser's malformed-body 400.

### Body limit, query and bounded values

- The app-wide JSON parser does the bounded read; its limit must be at least the largest route limit, which the target exports per api as a generated constant (`TasksNest.LARGEST_BODY_LIMIT` for the `tasks` api) for the setups above. The module middleware then checks the route's own limit and answers 413. It counts the parsed bytes, the raw body or the recorded byte count, whenever either is present, since the parser inflates a compressed body by default and `Content-Length` then gives the compressed size; `Content-Length` alone serves only for an early refusal, and as the body's size for a request without `Content-Encoding` or with `identity`. A request whose body size none of these gives (a chunked body, or a non-identity `Content-Encoding`, under the app's own parser) answers 500 in the slice, fail closed, with a log naming the setups; accepting it within the parser limit is a follow-up. A parser 413 whose limit is below the route's limit is a setup error, not the contract's refusal: the exported pre-routing filter and helper answer it with 500 and a log naming the generated constant.
- Media type: a contract route with a JSON body refuses another `Content-Type` with 415 in the module middleware, since the JSON parser only skips it.
- Query: decoded from the raw query string of `req.originalUrl` by the IR's wire form (ADR 0002 section 7), never from `req.query`. Path, query and header strings are decoded before the validator; a value that does not decode stays the raw string, so the validator reports it with every other issue in step 6's one pass, and the validator never coerces.
- The issues list rendered into error params is bounded by `MAX_RENDERED_ISSUES = 100`. Each issue is `{ in, pointer, rule }` (ADR 0006 section 6), `pointer` inside the part `in` names, and the binding's params template renders the list. `rule` is the contract keyword the value breaks, never the validator's issue code: `required`, `type`, `enum`, `format`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minItems`, `maxItems`, `oneOf` for a union, and `unknownKeys` for each unknown member, at that member's pointer. A check the validator reports as custom carries its rule name in the issue's `params.rule`, which codegen-zod writes on each custom check (code-point lengths, formats checked by a function); a regex the validator reports is always a format, since codegen-zod refuses `pattern`.
- A paged list's limit the client does not send reaches the handler as the operation's `defaultLimit`. `Cache-Control` is the operation's value for the caller kind, or `no-store` when `noStore` is set.
- The throttle bucket key and the idempotency key are fixed-size SHA-256 digests. The idempotency key digests the api id, the operation id, the identity id, a digest of the validated principal (none for an anonymous caller) and the client's key, never the credentials (ADR 0012 "Target obligations").

### Handler results

The generated handler interface takes the operation's `input` from the types link and returns its `output` or its `errors` (ADR 0007 roles): a success `{ status, body }` or a declared error `{ status, code, params }`, checked by the compiler. A code the operation does not list is a type error, and at run time a 500. The generated exception per code (`TasksLockedError`), thrown by the handler or a hook, comes right after the slice and goes through the same filter.

### Registration

Each api gets one dynamic module (`SeampactModule.forRoot({ authenticate, deciders, scopeResolvers, idempotencyStore, onUnexpectedError })`); `onUnexpectedError` is optional. Hooks are NestJS providers registered under explicit injection tokens: an authenticate hook per identity, or one serving several; a decider by a list of right and rule names, or all; a scope resolver per scope kind, or one serving several. Two deciders claiming one name is a boot error, and no default hook exists (ADR 0012 "Registration and per-right overrides"). Names that ADR 0007 has no role for are fixed words, without the api's segments: PascalCase for classes (`SeampactModule`), camelCase for decorators, functions and values (`responses`, `preRoutingFilter`, `keepRawBody`, `renderPreRoutingError`) and upper snake case for constants (`LARGEST_BODY_LIMIT`); the per-operation decorators follow "Placement". Each api's copy is its own module, so two apis in one app never collide once imported as namespaces (ADR 0007 "Amendment 2026-10-19: generated modules"). The api-neutral exports behave the same in every api's copy: `renderContractError` and `isContractRoute` read the api from the boundary's request context or the route metadata, and `MAX_CHECKED_ERROR_BODY_BYTES` and `MAX_RENDERED_ISSUES` are fixed values. Each api's boot check covers its own operations.

### The boot check

The module runs it in `onApplicationBootstrap`, before the app accepts a request, through NestJS's public `DiscoveryService` and `Reflector`; it lists every problem at once with the operation id, the name and the fix, and throws, so the app does not start:

- an identity used by a bound operation without an authenticate hook, a right or rule without a decider, a scope without a resolver, an idempotent operation without an idempotency store;
- two deciders claiming one name;
- a contract operation without a bound handler: no controller method carries its composite;
- on a contract method, a NestJS decorator that writes after the boundary's reply (`Redirect`, `Render`, `Sse`) or a developer `Res`, `Response` or `Next` parameter, the `passthrough` cookie idiom included, all read through `Reflector`: NestJS would write again after the reply and raise `ERR_HTTP_HEADERS_SENT`;
- a platform other than Express (`HttpAdapterHost`).

Two checks of ADR 0012's list move to the request, since NestJS 12 exposes no public read of them at boot (its `ApplicationConfig` is not injectable, and Express keeps the parser limit inside the parser): a parser limit below a route's limit is answered as above, and a NestJS global prefix, which differs from the empty `mount` the slice allows, is detected by the module middleware when the request path is a contract path under a leading prefix, and answers 500 with a log naming `setGlobalPrefix` and its `exclude` option. The middleware reads the request target raw from `req.originalUrl`, never through WHATWG `URL` (which turns `\` into `/` and resolves dot segments), so it checks the path Express routes. Express 5 also routes a path case-insensitively, with a trailing slash, and `HEAD` as `GET`; the contract serves none of these as sent, so each answers the path's `notFound` code (404) without calling the handler.

### What the generated code depends on

At run time: `@nestjs/common`, `@nestjs/core`, `rxjs`, the zod link's runtime and, for types only, `@seampact/hooks` (ADR 0009). It uses explicit injection tokens with `@Inject`, never `emitDecoratorMetadata`, so any transpiler that supports NestJS's legacy decorators runs it. It never imports `@seampact/signed-webhooks`: the app's authenticate hook calls it.

### Refused by name or waiting

`generate` refuses by name, with the case's code and its fix, every input the slice does not serve ([A47](../decisions.md#a47)); each comes with the bringer named:

- Waiting for the target after the slice: the NestJS Fastify platform (the boot check refuses a non-Express adapter); the thrown exception per error code; `nativeDocs` and `frameworkDocs`; the `class-validator` link style (ADR 0009); `hooks: vendored` ([A40](../decisions.md#a40)); `accessHooks: false` and `access: native` ([A42](../decisions.md#a42)); per-right overrides, record loaders, `decideMany` and decider params checks; form, multipart, download and redirect bodies ([A39](../decisions.md#a39)); `api.wire.urls: absolute`; handler groupings other than ADR 0007's `handlers` default.
- Waiting for the server entry keys of the CLI: `mount` and `frameworkRoutes`, with the boot checks of framework routes and of the installed hooks range.
- Every IR form absent from the reference contract's golden IRs is refused until a consumer needs it.

### Left to the handler

Some forms of the reference contract are validated or passed on by the boundary but enforced by the handler (ADR 0012 "Errors the handler answers"). `generate` names each with a warning, not a refusal, carrying the operation, the IR member and what the handler does, and the CLI prints it on stderr: `concurrency` (`concurrency.handler`: the handler compares the version and answers the `stateConflict` code), `owner: caller` (`owner.handler`: the handler scopes its reads and writes to the principal), the deadline header and `budgetMs` (`deadline.handler`), sort keys (`paging.sortKeys.handler`: the boundary validates the key, the handler orders by it) and an identity's `headers` (`identity.headers.handler`: validated as declared headers only). `filteredBy` carries no warning: grammar section 10 makes the list filter the application's own by design, reaching only the handler context and the documents.

## Consequences

- An app keeps its `main.ts`, its global pipes, guards, interceptors and filters; on contract routes the boundary's checks and reply win, and its own routes are unchanged, Express ETags included. A global interceptor that answers without `next.handle()` must skip contract routes with `isContractRoute(context)`, or those routes hang.
- Every reply on a contract route is written by generated code, so NestJS features that shape the reply (`@Header`, a global serializer interceptor) do nothing there, and the boot check refuses those that would write it again (`@Redirect`, `@Render`, `@Sse`, a developer `@Res()`).
- App filters keep working on contract routes; under `strict`, a reply of theirs outside the contract becomes a 500, and under `warn` a logged violation.
- Refusals raised before routing are in the api's format only when the app registers the exported global filter or calls its helper; the README's NestJS setup shows both.
- A raw-body or parser-limit setup error answers 500 on the routes it affects, with a log naming the fix, instead of refusing to start.
- The Fastify and Express targets reuse the shared request checks and cite this ADR for the obligations; only their placement is new.

## Traceability

- FRs: FR-5 (the check order), FR-14 (a case refused by name), FR-35 (the shared suite this boundary will pass); amendments A30, A36, A39, A40, A41, A42, A47.
- ADRs: 0007 (names), 0009 (links, run-time dependencies), 0012 (placement and target obligations), 0013 (raw body and signature header).
- Proof in the development phase: the review of this ADR, the spike above, and the slice's end-to-end gate on the NestJS consumer.

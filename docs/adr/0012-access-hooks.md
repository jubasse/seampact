# ADR 0012: Neutral access hooks

Status: accepted

## Context

Authentication, rights, roles and tenancy are unopinionated, even at the cost of less generated code (amendment [A25](../decisions.md#a25)). The contract declares what a route requires: an identity and its principal schema, requirements (rights and rules) with typed params and a subject, tenancy scopes, and the errors each can raise. It never says how a credential is checked, how a right is decided or how a tenant is found. Applications keep the libraries they already use: Clerk, better-auth, Passport, CASL, spatie/laravel-permission, Laravel Gates and Policies, Symfony Voters, Spring Security, or hand-written code (A25). seampact adapts to the framework's own mechanisms and never replaces them ([A30](../decisions.md#a30)).

Early research proposed mapping each right onto each framework's native authorization mechanism inside the target. A25 overrides that: targets generate neutral hooks only, and native mappings are optional adapter packages. Rights stay flexible ([A20](../decisions.md#a20)), a restricted input field is rejected or stripped by configuration ([A21](../decisions.md#a21)), and tenancy is open ([A23](../decisions.md#a23)). 1.0 ships the CASL and spatie adapters ([A24](../decisions.md#a24)).

Rights, rules, scopes and identities are declared with the grammar of ADR 0002 and recorded in the IR of ADR 0004. This ADR decides the runtime boundary every server target generates from them.

## Options

- Map each right onto the framework's native authorization inside the target (`#[IsGranted]`, `@PreAuthorize`, policies), as the rights research proposed; generate neutral typed hooks, with native mappings as optional adapters; or generate nothing for access. Choice: neutral hooks (A25), with native access as an opt-in setup ([A42](../decisions.md#a42), "Native access instead of hooks" below). A native mapping imposes one library per framework, and generating nothing leaves deny by default and the check order unenforced at the boundary.

## Decisions

### One neutral, typed hook per concern

Every server target generates exactly three hook interfaces (FR-25), unless the app turns `accessHooks` off for native access (below). Each is typed from the contract: the generated request types name the identity, right, rule or scope and carry its declared params, principal and error codes.

**Authenticate**, one per identity. It receives:
- the identity name and the credentials found in the locations the identity's schemes declare for this request (read or write schemes), including the CSRF companion value on a write through a cookie scheme that declares `csrf` (opt-in, [A34](../decisions.md#a34)); on a write that accepts a cookie and a bearer scheme, the derived `csrf` check applies to the requests authenticated by the cookie only. The boundary refuses such a write that carries only cookie credentials and whose CSRF header is absent or empty with the derived `csrfInvalid` code (403), before the hook runs; the hook still checks the value;
- for a signed identity, the raw body and the parsed signature fields (ADR 0013), or, for a scheme with `verify: application`, the raw body, the signature header and the scheme's declared headers, unparsed (ADR 0002 section 9, [A40](../decisions.md#a40));
- a read-only view of the request (method, path, headers, client address) and the operation reference;
- the operation's extension metadata (A20).

It answers a typed principal (tagged with its variant when the identity declares several, FR-27) or a denial limited to the identity's declared codes. The hook is not called when no declared credential is present: the boundary answers 401, or continues with a null principal on a public or optional-auth route. A refused credential on an optional-auth route is treated as anonymous (FR-4), or answers 401 when the route says `onRefused: reject` (A40). The boundary validates the returned principal against the principal schema; an invalid principal is a server error (500), never accepted. The principal reaches later hooks and the handler as its schema declares: members the schema does not declare are dropped, like undeclared output fields.

**Decide**, for every requirement, right or rule. It receives:
- the kind (right or rule), the name and the typed params declared at the use site;
- the principal, or null for an anonymous caller on a public or optional-auth route: always possible for a rule, and for a right only when it is guest-enabled, since a non-guest right on such a route is a compile error (FR-22, SCN-036, SCN-063);
- the subject reference, when the right has one: the subject type and the id taken from its declared source, checked against its schema first when that source is the request; plus the loaded record when the application registers a loader for that resource type, in which case the handler receives the same record;
- the resolved scopes, outermost first;
- the rule's proof, when the rule declares one (FR-41), and for a throttle requirement the bucket with its key sources and limits;
- the purpose (route requirement, restricted field with its pointer and direction, or restricted sort key);
- the operation reference, a read-only request view and the extension metadata of the right or rule and of the operation (A20).

It answers allow, or a denial naming one of the declared codes with that code's typed params (for example a retry delay on a rate-limit reply). An optional batch form decides several requests at once, for restricted fields over a list; by default the boundary loops. Identical requests within one HTTP request are decided once.

**Resolve scope**, one per scope kind. It receives the scope name, the id from the declared source (path, query, header, host or subdomain, principal field), already decoded and validated against the scope's id schema, or, for a custom resolver, no id and the request view; plus the principal and the scopes resolved before it. It answers the resolved scope (its id and an optional application value carried untouched to later hooks and the handler) or one of the scope's declared membership denials.

The shape, in TypeScript, for illustration only (the generated names follow ADR 0007, and the generic types live in the hooks package of ADR 0009):

```ts
export interface DecideHook<R extends RequirementRequest> {
  decide(request: R): Decision<R['deniableCodes']> | Promise<Decision<R['deniableCodes']>>;
  decideMany?(requests: readonly R[]): Promise<readonly Decision<R['deniableCodes']>[]>;
}
export type Decision<C extends ErrorCodeWithParams> = { allow: true } | { deny: C };
```

### Your controller, the generated utilities around it

No target generates the framework controller ([A41](../decisions.md#a41)). The developer writes the controller, or its framework's equivalent, and implements on it the generated interface of its resource, tag or operation (ADR 0007 `handlers`), whose methods carry the exact input and output types. Codegen emits only what sits around that controller: types, validators, interfaces, and utility annotations, attributes, decorators, middleware or hooks that place every step of the check order (below) in the framework's own pipeline. Where the language composes annotations, each operation gets one composite the developer puts on its method; where it does not (PHP attributes), a generated attribute names the operation and a generated listener reads it. Every artefact is switchable in the app config, and all generated code goes to the app's one generated directory, `__generated__` by default (ADR 0011).

| Target | The developer writes | Generated around it |
|---|---|---|
| nestjs | a `@Controller()` class implementing `TasksEndpoints`, each method decorated with its operation's composite and taking the operation's input decorator: `@TasksNest.updateTask() update(@TasksNest.updateTask.input() input: Tasks.UpdateTaskInput)` (namespace imports, ADR 0007 "Amendment 2026-10-19: generated modules") | per operation, a composite method decorator built with `applyDecorators`: the verb and the full contract path (`Version(VERSION_NEUTRAL)`, so a global prefix is the `mount`), the seampact guard (steps 2 to 5; guards run before interceptors and pipes, and it runs after the app's own route guards), a wrapper of the controller method (step 10 and the write of the reply, or, with the target option `reply: interceptor`, a global seampact reply interceptor that runs step 10 on the value the app's interceptors map), `SetMetadata` with the operation id and access kind, and, with `nativeDocs`, the `@nestjs/swagger` decorators that complete the framework's document (ADR 0011); per operation, a param decorator made with `createParamDecorator` carrying the seampact input pipe (steps 6 to 8, after the app's pipes), which hands over the validated input, since `applyDecorators` cannot compose parameter decorators; the module registering the hooks, the exception filter of the format, and the boot check |
| fastify | handler objects implementing the generated interface | an encapsulated plugin registering each route with `onRequest`, `preParsing`, `preValidation` and `preHandler` hooks for steps 1 to 8, the boundary's reply through `reply.hijack()` and the outgoing response check on `reply.raw` for step 10 (ADR 0017) |
| hono | handler objects implementing the generated interface | one route handler per operation registered by `registerRoutes(app, options)` running steps 1 to 10 on the Web `Request`, and the outgoing response check around the app's `fetch` (ADR 0020) |
| express | handler objects implementing the generated interface | a router factory mounting each route behind generated middleware for steps 1 to 8, the boundary's reply written with `res.end` and the outgoing response check on `res` for step 10 (ADR 0018) |
| adonis | a controller implementing the generated interface, passed as a lazy import to the generated registration called from `start/routes.ts`: `TasksAdonis.registerRoutes(router, { controllers: { TasksEndpoints: () => import('../app/controllers/tasks_controller.js') }, hooks })` | a registration adding each operation's route with inline route middleware for step 1, for steps 2 to 5 and for steps 6 to 8 (the zod validators run there in the slice, the VineJS validators next), and a route handler that calls the controller method with the validated input and writes the reply (step 10); a validated-input accessor that only reads the result the middleware stored; a helper the app's exception handler calls to render, in the api's format, refusals raised before the route middleware (ADR 0019) |
| spring-boot | a `@RestController` implementing the generated interface, each method annotated with its operation's composed annotation (`@UpdateTask`) | per operation, a composed meta-annotation carrying `@RequestMapping` with the method and the contract path, without `@ResponseStatus`; a servlet filter ordered before Boot's request-wrapper filters and Spring Security that captures the raw body within the route's limit (step 1) and checks the outgoing response; a `HandlerInterceptor` that runs steps 2 to 8 on the decoded body before Spring binds any argument; a `HandlerMethodArgumentResolver` handing the validated input record to the method; a `HandlerExceptionResolver` placed first writing the declared format (`ProblemDetail` only for `application/problem+json`), and a `HandlerMethodReturnValueHandler` placed first for step 10 (ADR 0022). Nothing relies on `@PreAuthorize`, which runs after argument binding |
| laravel | a controller implementing the generated interface, bound in the container | a global middleware prepended before every other one for steps 1 and 10; a routes file (or a `Route::seampact()` macro) registering each operation with a route middleware placed before `SubstituteBindings` for steps 2 to 5 and the operation's generated FormRequest, type-hinted on the method: `validationData()` returns the boundary's decoded input, its rules run step 6, `passedValidation()` runs steps 7 and 8, `failedValidation()` renders the `schemaInvalid` 400 (ADR 0023) |
| symfony | a controller service implementing the generated interface, its methods marked with the generated `#[SeampactOperation('updateTask')]` attribute | a route loader registering each operation natively; a `kernel.request` listener placed before routing and the firewall for step 1, and a `kernel.response` listener placed last for step 10 and the mapping of the framework's refusals; a `kernel.controller` listener that reads the attribute through `ControllerEvent::getAttributes()` and runs steps 2 to 8, then stores the validated input in a request attribute; a value resolver for the input argument, the interface method's first parameter, that only reads that stored input; a `kernel.exception` listener rendering the generated exceptions in the format (ADR 0024). Symfony resolves controller arguments after `kernel.controller` and before `kernel.controller_arguments`, so a listener on the latter, or a resolver that validated by itself, would run after argument resolution or before authentication; Symfony's `#[IsGranted]` and `#[IsCsrfTokenValid]` listen at `kernel.controller_arguments`, after steps 6 to 8, so the boot check refuses them on a contract method |
| api-platform | State Providers and Processors implementing the generated interfaces | resource metadata for each operation (`uriTemplate`, `uriVariables`, and the contract operation id as the operation `name`); the same `kernel.controller` listener for steps 2 to 5, which finds the operation from the request's `_api_operation_name`, since the controller there is API Platform's own; a generated provider decorating API Platform's deserialize provider that runs steps 6 to 8 on the decoded body before denormalisation, so restricted input fields are rejected by the target's own check, since API Platform's property security only strips (A21, A42); decorated processors for step 10 |

What the boot check calls a bound handler is, per target, this developer code: a controller method carrying the operation's composite (nestjs, spring-boot), a container binding of the interface (laravel), the controller a `controllers` entry of the generated registration imports (adonis, ADR 0019), a service carrying the operation's attribute (symfony), a provider or processor for the operation (api-platform), an entry of the handler map (fastify, express, hono).

Bodies beyond JSON ([A39](../decisions.md#a39)) use each framework's own mechanism, with the contract's limits:

| Target | Form and multipart input | Download | Redirect |
|---|---|---|---|
| nestjs | the platform's parsers (`urlencoded` and multer on Express, `@fastify/formbody` and `@fastify/multipart` on Fastify) configured by the composite | `StreamableFile` | `@Redirect()` in the composite, the location from the typed result |
| fastify, express | `@fastify/formbody` and `@fastify/multipart`; `express.urlencoded` and multer | a stream with `Content-Type` and `Content-Disposition` | `reply.redirect()`, `res.redirect()` |
| adonis | `request.file()` checked with `vine.file()` | `response.stream()` or `response.download()` | `response.redirect()` |
| spring-boot | the decoded form, and `MultipartFile` through Spring's multipart resolver | `ResponseEntity` of a `Resource` or `StreamingResponseBody` | `ResponseEntity` with the status and `location(uri)` |
| laravel | request input and `UploadedFile` with `file`, `mimetypes` and `max` rules | `response()->streamDownload()` | `redirect()->to()` |
| symfony | `Request::$request` and `UploadedFile` with the `File` constraint | `BinaryFileResponse` or `StreamedResponse` | `RedirectResponse` |
| api-platform | the `multipart` input format through a generated decoder and denormalizer, API Platform's documented way to take files | a `Response` from the processor | a `RedirectResponse` from the processor |

Client targets send forms with `URLSearchParams` and `FormData`, return a download as a `Blob` or a stream with its media type, and read a redirect with `redirect: 'manual'` where the platform exposes it.

### Registration and per-right overrides

Each target registers hooks through its framework's own mechanism (A30): providers and a dynamic module in NestJS, options of the generated plugin in Fastify, the router factory in Express, one value passed to the generated registration in AdonisJS, container bindings later (ADR 0019), beans in Spring, service-provider bindings in Laravel, tagged services in Symfony.

- An authenticate hook is bound per identity, or one implementation declares the identities it serves.
- A decider declares the right and rule names it answers, or declares that it answers all of them.
- An override binds one implementation to one right or rule name and wins over every other decider for that name (A20, CHK-091). The others keep using the generic decider.
- Two non-override deciders claiming the same name is a boot error.
- A scope resolver is bound per scope kind, or one implementation declares the kinds it serves.
- A decider may expose a boot-time params check, called once per requirement use with the static params from the contract, to refuse values it does not understand (an unknown role name, for example).

No target ships a default hook, and nothing falls back to allow.

An app that serves several apis (a public api and a service api in one NestJS app, each with its own server target in the app config, ADR 0011) gets one boundary per api. Each api's hooks are typed from its own IR, so an identity that both apis declare through a shared file gives two authenticate interfaces, which one class may implement; each api's boot check covers that api's operations; and the generated modules, providers and route tables carry the api's name, so the two never collide.

### The boot check

The app config's `artefacts.bootCheck.hooks` sets the level for missing hooks: `error` refuses to start, `warn` logs them and starts, `off` starts silently, and a route whose hook is missing then answers 500; a right claimed by two deciders refuses to start at every level.

Before the application accepts a request, the generated boot check refuses to start, listing every problem at once with the operation id, the name and the fix, when:
- an identity used by a bound operation has no authenticate hook;
- a right or rule used by a bound operation has no decider;
- a scope used by a bound operation has no resolver;
- a contract operation has no bound handler, among the operations the target entry's `operations` filter keeps (ADR 0011);
- a framework route is absent from the generated route table and not allow-listed with a reason in the app config, by its path or a path pattern (`/actuator/**`, ADR 0011), apart from the routes of the framework's own document while it is on, which the target reads from the framework's configuration and reports (ADR 0011);
- the framework adds a path prefix of its own to the contract routes (a NestJS global prefix, a Laravel route group, a Hono base path, an Express mount path); the contract routes are registered under the target entry's `mount` (ADR 0011), which is where such a prefix is written;
- a decider's params check refuses the params of a requirement;
- the installed hooks package is outside the range the generated code needs.

Node targets that cannot read a setting at boot check it on the request instead and answer 500 with the fix logged (ADR 0016, ADR 0019).

By default the framework-route check looks only at the app routes that can serve a path at or under one of the api's mounted base paths, so an app's routes beside the api are its own; `artefacts.bootCheck.frameworkRoutes: strict` checks every app route, and an api with no base path and no mount is always checked whole. The scope fails closed: a route segment with any route syntax reads as a param, and as a catch-all when its pattern may take a `/` or cannot be read (`/:rest{.+}`, `/api{rest}` with `.+`); a route written as a regular expression is always checked; on Node and Spring a literal segment compares without case, as Express and a case-insensitive parser match it. The framework-route check lists the routes the framework registers when the check runs; a route added after it is not seen, and middleware that answers requests is not a route, so neither is listed. A route is the contract's when the generated code registered it, never because its path equals a contract path.

In PHP, where an application boots per request, the check runs when the container or route cache is built and at boot when no cache exists; the generated dispatcher also answers 500 rather than call a missing hook.

The app config may switch off the handler check and the framework-route check apart (`artefacts.bootCheck: { handlers: false, frameworkRoutes: false }`), for an app that serves part of an api or registers many routes of its own; while the target generates hooks, a missing hook is always refused, since nothing may fall back to allow.

### The check order

The order is fixed in every target and stops at the first failure (FR-5):

1. Transport refusals raised while the framework parses: unknown route (404), body too large (413), unsupported media type (415), malformed body (400), and the refusals of the framework's own security layers (below), rendered in the api's declared error format (ADR 0008). A malformed body is one that does not parse as its declared media type; a value of the wrong type is a step 6 issue.
2. Authenticate (401), over the raw body for a signed identity.
3. Principal requirements (403).
4. Scope resolution, outermost scope first (each scope's declared denial). A scope id is checked against its schema before its resolver runs; an invalid one answers the `schemaInvalid` 400 with that member's issues only.
5. Requirements in declared order. A body proof is read from the parsed body and checked against its own field schema in this step; an invalid one answers the `schemaInvalid` 400 with that member's issues only, before the decider runs. A subject id or a throttle bucket key read from a path param is checked the same way before its decider runs. A registered record loader runs here, before the decide call that receives the record; a record it does not find answers the `notFound` role at this step, before any 403 (as Laravel's route-model binding and API Platform's providers do).
6. Input validation (400), reporting every issue of path, query, headers and body at once. On a route with a scope id or a body proof, step 6 reuses the validation steps 4 and 5 ran, so it validates the request as read there: a body that app code rewrites between those steps is not validated again.
7. Restricted input fields (403 with the field pointer, or stripped, per A21) and restricted sort keys (403).
8. Principal bindings (403). A binding whose principal side or input side is absent or null is a mismatch, never a match.
9. The handler.
10. The response: an undeclared status answers 500; restricted output fields are projected out; undeclared fields are stripped; sensitive values are redacted from logs; the success or error format, cache, identity and deprecation headers are written. No framework-generated validator or 304 reaches a contract route: a target turns off its framework's automatic ETags there (Express sends weak ETags and 304s by default), and only `cache.etag` produces them.

Each target places the steps in its framework's mechanisms, in this order, through the generated utilities above. Steps 1 to 8 are one generated pipeline with one rule everywhere: the body is first decoded to the language's JSON tree (a JavaScript value, a Jackson `JsonNode`, decoded PHP objects), never bound to a typed object; step 6 validates path, query, headers and body in one pass, the linked validator library (class-validator, zod, yup, VineJS, Bean Validation, Laravel rules, Symfony constraints) running inside that pass, and only then converts to the typed input. The boundary uses its own decoder settings, never the app's global pipe, Jackson mapper or serializer, so an app's `ValidationPipe` with `forbidNonWhitelisted` or a flipped `FAIL_ON_UNKNOWN_PROPERTIES` changes nothing the contract says. In spring-boot this is why the steps run in the `HandlerInterceptor`, on the decoded body, before argument binding (FR-19). A framework that sets a fixed route status and re-applies it on reply (NestJS) gets the status from the generated reply path, never from an interceptor's `res.status()`.

### Restricted fields

- On output, a field whose right the caller lacks is absent, never null. On a public route it is always absent unless its right is guest-enabled (FR-23).
- On input, a restricted field sent without the right is refused with 403 and the field pointer by default, or stripped; the policy is set per api in the conventions and may be overridden per field (A21).
- The boundary asks the decide hook with the field purpose and the subject derived from the right's declaration (ADR 0003 section 6): the route's resolved scope for a scope right; for a resource right, the holder's id property on output and the route's default subject on input and for sort keys. On output it also passes the holder object as the loaded record. It never walks schemas at run time: the IR lists each operation's field rights with their subject source (FR-23).
- An output field whose subject cannot be found on a route (a scope right on a route outside that scope) is always absent there, without a decide call (ADR 0003 section 6).
- A relay route has no field rights (ADR 0002 section 7): the service app sends every field and asks no decider about a member's right, and the public operation, in the gateway, projects the output and checks the input for its own caller.

### Errors the handler answers

A handler answers any code its operation lists through a typed error result that the target generates per operation, and the boundary renders it in the operation's wire format. That covers the codes declared or attached on the route and its nodes (`tasks.locked`), and the derived roles only the application can decide: `notFound` on a member route, whose id may not exist and that no scope reads (ADR 0006 section 5), and `stateConflict` for a stale version. In TypeScript, for illustration:

```ts
return { error: 'tasks.locked', params: { lockedBy: lock.userId } };   // typed from updateTask's error union
```

A handler may instead throw the generated exception of a code, one class per code with its typed params in the constructor, named with ADR 0007's `error` role (`TasksLockedError`; the per-operation error result takes the `errors` role, `UpdateTaskErrors`), which is the idiom of NestJS (`HttpException` with an `errorCode`), Spring, Laravel, Symfony and API Platform (`ProblemExceptionInterface`). A target offers the form its language favours, or both. Java targets declare the operation's error exceptions on the interface method, which keeps the compile-time check; PHP targets declare them with `@throws`, for static analysis. A code the operation does not list is a type error where the language can tell, and at run time a 500, as for a hook's undeclared denial.

`owner: caller` (ADR 0002 section 6) derives a 404 for another caller's id, but the boundary cannot know who owns a record. No hook is added for it: the handler, or the optional record loader above, answers the `notFound` role with that typed result. The generated test helper checks the declared 404 (SCN-004).

### Open tenancy

A route runs in zero, one or several nested scopes (A23). Each scope id comes from a declared source or from a custom resolver; no resolution scheme, tenant model or storage is imposed. The resolved scopes reach every later hook and the handler through a request context built on the framework's own facility: `AsyncLocalStorage` in the Node targets, request attributes in Spring, Symfony and Laravel.

### Custom metadata

Extension values declared on rights, rules, scopes and operations (ADR 0008) reach the hook requests and the route metadata, typed from their JSON Schemas (A20). An application can, for example, attach an audit category to a right and read it in its decider.

### Optional adapters

An adapter is a separate package that implements one or more hooks with a library (ADR 0009). No target depends on one, and every target passes the HTTP suite with hand-written hooks and no adapter installed (CHK-098). Each adapter has its own conformance tests, including the rights and scope cases of the HTTP suite.

1.0 ships two (A24):
- `@seampact/nestjs-casl` answers the decide hook with CASL: an application-supplied factory builds the ability for the principal; a right maps to an action and subject type, by a configurable table that defaults to splitting `<resource>.<action>` names; the check uses the loaded record when a loader is registered; field rights use `permittedFieldsOf`.
- `seampact/laravel-spatie` answers the decide hook through Laravel's Gate, with spatie permissions named after the rights by default (configurable), and sets the permission team from the resolved scope before each decision.

Other libraries plug in through the same hooks, as application code or community adapters, without replacing the library's own mechanism:

| Library | Hook | How |
|---|---|---|
| Clerk | authenticate | verify the session token with Clerk's backend SDK and build the principal from the claims |
| better-auth | authenticate | read the session from the request headers through better-auth's server API |
| Passport | authenticate | run the strategy inside the hook, or keep Passport's guard or middleware and read the user it set; a global Passport guard reads the operation's access kind from the route metadata (below) and lets public and optional-auth routes through |
| Laravel guards and Sanctum | authenticate | read the user from the configured guard |
| Laravel Gates and Policies | decide | ask the Gate for the principal, passing the subject and params |
| Symfony Security and Voters | authenticate, decide | read the user from the token storage after the firewall; call `isGranted` with the right name and a subject object carrying params and scopes |
| Spring Security | authenticate, decide | read the `Authentication` set by the filter chain; delegate to a `PermissionEvaluator` or an `AuthorizationManager` bean. On an optional-auth route with `onRefused: anonymous`, the resource server's bearer filter must not answer 401 itself: exclude those routes with the generated request matchers (below), or verify the token inside the authenticate hook |

### Native security layers

A framework's own security layer often runs before the boundary: a global NestJS `APP_GUARD` (Passport, `ThrottlerGuard`), Spring Security's filter chain, Laravel's `VerifyCsrfToken`, `ThrottleRequests` and guards, Symfony's firewall. seampact neither removes them nor lets them contradict the contract (A30, A42):

- Every target exports each operation's access in the framework's native form: route metadata a guard reads through `Reflector` in NestJS (set by the operation's composite), request-matcher sets per access kind (public, optional, identity, signed) in spring-boot, route names and middleware groups in laravel, request matchers for `access_control` in symfony and api-platform. An app's own layer can therefore skip public and optional-auth routes without a hand-kept list. spring-boot can also generate, opt-in, a Spring Security customizer that permits the public and optional-auth routes and keeps them out of the bearer filter (target option `springSecurity: { matchers: true }`, A42).
- The target maps the framework's own refusals to roles and renders them in the api's error format, at step 1: Spring Security's entry point, access-denied handler and CSRF refusal; Laravel's `AuthenticationException`, `AuthorizationException`, `TokenMismatchException` (419 there, the `csrfInvalid` role here) and `ThrottleRequestsException`; Symfony's entry point, `AccessDeniedException`, an authenticator's failure (recorded from `LoginFailureEvent`), `InvalidCsrfTokenException`, `TooManyLoginAttemptsAuthenticationException` and RateLimiter's `RateLimitExceededException`; NestJS's `UnauthorizedException`, `ForbiddenException` and `ThrottlerException`. A refusal the operation does not list is a 500, as for a hook.
- On an optional-auth route with `onRefused: anonymous`, no native layer may refuse a presented credential: the app excludes those routes from its token filter (the exported matchers name them), or lets the authenticate hook verify the credential. With `onRefused: reject`, a native 401 is the contract's.

### Native access instead of hooks

An app that keeps its framework's native access (Spring Security rules, Laravel Policies on routes, Symfony `access_control`) and wants seampact's types, validation and routes only turns the access hooks off (A42): `artefacts: { accessHooks: false }` with `access: { native: "<reason>" }` on the target entry (ADR 0011). The reason is required, since access leaves the boundary; turning the artefact off without it is refused, naming both keys. The target then generates no hook interfaces and no steps 2 to 5, and exports every operation's identity, requirements and scopes as route metadata for the native layer to enforce. The boundary has no principal in that setup, so an operation whose contract needs one at the boundary (principal requirements, bindings, field rights, restricted sort keys) is refused by `generate`, naming the operation and the construct, with the fix "keep the access hooks for this api". The generated test helper still checks every declared 401 and 403, so the native layer is held to the contract.

### Target obligations

Each target's own ADR states, besides its placement above:

- nestjs and express: no framework ETag or 304 on contract routes (step 10); nestjs: the reply path for a dynamic status (several 2xx, a 304, an idempotent replay), since an interceptor's `res.status()` is overwritten by the route status; the stored reply of an idempotent request, error or success, is completed in the outgoing response check, the only place that sees replies written by the app's own exception filters (ADR 0016).
- Every target: the per-route body limit as a generated check (`Content-Length`, then a bounded read; a multipart body counted on the raw stream as its bytes arrive, never after a framework has buffered the whole upload; on laravel and symfony, where PHP stores an upload before any PHP code runs, the boundary refuses a declared `Content-Length` above the route limit and `post_max_size` and the web server's limit bound the rest, ADR 0023 and ADR 0024), the framework's app-wide parser limit set at least to the largest route limit; query decoding from the raw query string (ADR 0002 section 7). Under `api.wire.urls: absolute`, the configured public origin every URL it writes starts with (ADR 0004 section 13), never the request `Host` or forwarded headers, a target without one refusing to generate or to start. A bound on the issues list it renders into error params, a constant its ADR names.
- Every target: the bucket key a throttle stores is bounded (a hash or a fixed-size digest of the key, never the raw string), and so is the idempotency key its replay store keeps. That idempotency key is derived from the api id, the operation id, the identity id, a digest of the validated principal (none for an anonymous caller) and the client's key, so two authenticated callers never share a replay; anonymous callers share one partition, where the fingerprint still binds the body. It never digests the accepted credentials: a retry after a token or session refresh stays in the same partition, provided the principal the authenticate hook returns is the same across the refresh (no expiry, token id or session id in it). An error reply (400 to 499) the outgoing check sees marked `Cache-Control: no-store` is not kept in the replay store: it is dropped as a 5xx is, so a retry runs again. A `no-store` success (a write answering a sensitive field) is kept and replayed to the same partition, so a retry never runs the write twice. The request fingerprint digests the method, the contract path and the validated input with only the header params the author declared and a union tag, which selects the body variant: any other header param the compiler derives (a trace id, a deadline, the idempotency key, a CSRF token) is left out, so a retry with a new trace id or deadline replays.
- spring-boot and api-platform: the paging request roles are validated, `overLimit` included, before a native `Pageable` or paginator is built, since both clamp silently (ADR 0002 section 14).
- laravel: the rule mapping of ADR 0003's Consequences (`present` for a required string, whole-number integers, objects preserved, `TrimStrings` and `ConvertEmptyStringsToNull` excluded) and the `failedValidation()` re-render from 422 to the `schemaInvalid` 400.
- spring-boot, laravel, symfony and api-platform: `toString()` of a generated record and PHP's `var_dump` and `print_r` (`__debugInfo()`, `#[\SensitiveParameter]` on constructors) never show a `sensitive` value.
- angular: `HttpClient`'s XSRF support (`withXsrfConfiguration`) set from the contract's CSRF header name.
- fastify: when no validator is linked, one generated Ajv validator over the whole request with the boundary's own options, in step 6's single pass, never Fastify's per-part route `schema` (ADR 0009); adonis: with no validator link, a generated VineJS validator (ADR 0019), strict input as a generated rule, since VineJS drops unknown keys. Ajv runs with `multipleOfPrecision: 12` and `ownProperties: true`, and its schemas are compiled at module load.

### Failures inside hooks

- A hook may throw the generated exception of one of its declared codes, as a handler may. A framework's own denial exception thrown inside a decide hook (Laravel's `AuthorizationException` from `Gate::authorize()`, Symfony's `AccessDeniedException` from `denyAccessUnlessGranted()`, Spring Security's `AccessDeniedException`) answers the requirement's first declared denial code, so an idiomatic decider body works as written. A route requirement's denial that hides the record (Laravel's `Response::denyAsNotFound()`) answers the operation's `notFound` code instead when the operation declares one (a field right keeps its own code), so the reply does not reveal that the record exists.
- Any other exception thrown or rejected by a hook produces 500 with the error logged; it never counts as allow.
- A denial naming a code the requirement did not declare produces 500: the contract would otherwise be broken silently.
- A hook result is exclusive: the three hook results (decide, authenticate, resolve scope) carry one arm each, and a result with both arms or with neither produces 500, since the hook's answer would be ambiguous.
- Timeouts and retries inside a hook are the application's concern.

## Consequences

- Each target generates less than a native mapping would (no `#[IsGranted]`, `@PreAuthorize` or policy registration), and the application or an adapter writes a few lines of glue. In return no target imposes a library, a right naming scheme or a tenancy scheme. An app that prefers its framework's native access keeps it, with seampact's metadata, at the cost of the principal-dependent checks.
- No target owns a controller: the developer's controller stays the developer's, and regenerating never touches it (A41).
- The same HTTP suite proves every target, because every target exposes the same three hooks.
- The check order is a contract fact. A framework whose natural order differs (Spring's argument validation, NestJS guards before pipes) is adapted by the generated code, not by the application.
- The CASL and spatie adapters show how to write an adapter; community adapters follow the same hooks package.

## Traceability

- FRs: FR-4, FR-5, FR-16 (controllers stay the developer's, A41), FR-19 (spring-boot check placement), FR-22, FR-23, FR-24, FR-25, FR-26, FR-27, FR-41, FR-10 (metadata reaches the boundary); amendments [A18](../decisions.md#a18), A20, A21, A23, A24, A25, A30, A39, A40, A41, A42, [A43](../decisions.md#a43).
- Checklist items enabled: CHK-004, CHK-006, CHK-007 (identities, variants, CSRF), CHK-014 (order and boot refusal), CHK-015, CHK-016 (throttle bucket and proof reach the hook), CHK-017, CHK-018, CHK-019, CHK-020, CHK-025, CHK-033, CHK-062, CHK-063, CHK-086, CHK-087, CHK-090, CHK-091, CHK-092, CHK-093, CHK-094, CHK-096, CHK-097, CHK-098, CHK-099, CHK-116 (no second 404 for a scoped id), CHK-117 (no field rights on a relay route); CHK-131, CHK-133, CHK-147, CHK-150 to CHK-158, CHK-161 to CHK-164, CHK-168, CHK-169; CHK-170 (framework document routes in the boot check), CHK-174 (symfony, api-platform, adonis and fastify step placement).
- Success metric: SM-8.

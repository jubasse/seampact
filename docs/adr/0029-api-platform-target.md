# ADR 0029: The API Platform server target

Status: accepted, Symfony flavour delivered by #427, #429, #437, #445, #448; the Laravel flavour and app input rules in 1.2.0

## Context

[A15](../decisions.md#a15) and [A28](../decisions.md#a28) name API Platform as a PHP target that adapts to the framework rather than disabling it, with its native look (JSON-LD items, Hydra collections and errors) from the opt-in `@seampact/pack-api-platform` ([A32](../decisions.md#a32)). ADR 0012 placed its steps in its target table, ADR 0010 "API Platform spike" listed what a spike had to settle first, and ADR 0024 fixed the Symfony target, whose kernel, listeners, runtime and obligations this target runs on. API Platform was moved after 1.0; this ADR fixes the target for 1.1. What it does not restate holds as ADR 0016, ADR 0023 and ADR 0024 say.

Five API Platform behaviours, seen in the spike below, shape the placement:

- Every API Platform operation is a Symfony route served by one controller, `ApiPlatform\Symfony\Controller\MainController`. Its routes come from resource metadata: the operation's `uriTemplate` is the path, its `name` the route name, and its `defaults` reach the request attributes. `debug:router` shows the exact name and path the metadata gives.
- The controller runs API Platform's provider chain, then its processor chain. The provider chain is content negotiation, parameters, read, deserialize, then validate; its `security` and `pre_read` checks run before the body is denormalized, `securityPostDenormalize` and `securityPostValidation` after. All of it runs inside the controller, so after `kernel.controller`.
- `MainController` always returns a `Response`, so `kernel.view` never fires on an API Platform route. `kernel.response` still does.
- API Platform's own wire differs from the pack in three places: the item `@id` comes from its `IriConverter`, which needs every parent id of a nested template as a property of the object; its error body adds `description` and, in debug, `trace`, and has no `code` or params; a failed validation answers its own 422 `ConstraintViolation` body. A `page` its paginator cannot use answers 500.
- Providers and processors are services that a decorator wraps with `#[AsDecorator]`; a lower decoration priority runs outer, the inverse of the intuitive reading.

## Options

- API Platform lines: 4 and 5, or 5 only. Choice: 5 only. Composer resolves 5 for a new app (the spike got 5.0.6), and each supported line is a matrix of its own. API Platform 4 comes only on demand; until then the compatibility matrix records it as unsupported and `generate` refuses it by name (ADR 0009 "Artefacts and the compatibility matrix").
- Flavours: Symfony and Laravel together, or Symfony first. Choice: Symfony in 1.1.0, Laravel in a 1.2.0 release. The Laravel flavour has the same shape but its own routes, middleware and error handler, about 0.6 of the Symfony work ("The Laravel flavour" below).
- Who writes the wire: API Platform's serializer, `IriConverter` and error normalizers, or the boundary. Choice: the boundary, as on every other target. API Platform rendering would need resources that carry every identifier for their IRIs, and would make the wire depend on the framework's normalizers, where the contract guarantees one wire whatever the target. The native look is a pack concern ("The native look"), never a per-target switch of the reply check.
- Routes: a route loader as on Symfony, or API Platform's resource metadata. Choice: the metadata. It gives the exact path, name and defaults with no loader, and API Platform's documentation, context routes and security glue keep working on the same operations.
- Steps 2 to 8: in decorators of API Platform's providers (ADR 0012's api-platform row), or in the Symfony target's `kernel.controller` listener. Choice: the listener. It runs before the whole provider chain, so before API Platform's `security`, read and deserialize, with no API Platform change.
- The operation marker: the method attribute the Symfony listener reads, the route default, or the operation's extra properties. Choice: the route default. The resolved controller is always `MainController`, so no method carries the attribute, and the route default is set by the same metadata that names the route.
- The reply path: `kernel.view` as on Symfony, or a processor. Choice: a generated decorator of API Platform's main processor, since `kernel.view` never fires.
- App input rules ([ADR 0028](0028-app-input-rules.md)): in 1.1.0, or with Python and Spring Boot in 1.2.0. Choice: 1.2.0, refused by name until then, which keeps ADR 0028 §9's scope.

## Decisions

### What stays API Platform's

API Platform routes the contract operations, writes its own OpenAPI document and serves its context, documentation and entrypoint routes, and keeps its security glue (`security` expressions, voters, the firewall in front). The boundary writes every reply on a contract route, runs the check order of ADR 0012, and judges the reply with the outgoing check. API Platform's serializer, `IriConverter`, paginator, validator and error normalizers never write a contract body.

### Placement

The developer writes the same handler services as on Symfony: classes implementing the api's generated interfaces (ADR 0007 `handlers`, `TasksEndpoints`), each method marked with the api's generated `#[SeampactOperation]` attribute, taking the operation's generated input and returning its generated result or throwing one of its generated exceptions. The handler code, its tests and the generated types are the Symfony target's, so an app moves between the two targets without rewriting them; API Platform's `ProviderInterface` and `ProcessorInterface` signatures never reach app code.

`seampact/api-platform` (`Seampact\ApiPlatform`) generates, per api, beside the Symfony target's types, inputs, results, exceptions, constraints and bundle:

- **The resources**: one `#[ApiResource]` class per contract resource, whose short name is the pack's `$resource`, so the `@context` the pack writes (`/contexts/<Resource>`) is API Platform's own context route. Each contract operation is one API Platform operation on it ("Routes").
- **One processor per operation**, implementing API Platform's `ProcessorInterface`, a safe operation (`GET`) included, so every handler runs after API Platform's `security` ("The check order"). Each reads the typed input that the `kernel.controller` listener stored, calls the developer's method and returns its result. The bound handler of ADR 0012 "The boot check" stays the service implementing the generated interface, as on Symfony.
- **The boundary subscriber**, a subclass of the Symfony target's `BoundarySubscriber` that reads the operation marker from the route ("The operation marker"), with the same listeners and priorities: step 1 at `kernel.request` 512, the routed marker at 31, steps 2 to 8 at `kernel.controller` 0, the exception record and rendering, `LoginFailureEvent`, step 10 at `kernel.response` -2048, on the main request only (ADR 0024 "Placement").
- **The reply decorator** of `api_platform.state_processor.main` ("The reply path").
- **The bundle** per api, as on Symfony, without the route loader and the input value resolver, which no API Platform operation uses.

### Routes

Each contract operation is one API Platform operation whose metadata the generator writes in full:

```php
#[Get(
    uriTemplate: '/v1/channels/{channelId}/tasks/{taskId}',
    name: 'seampact.tasks.getTask',
    defaults: ['_seampact_operation' => 'getTask'],
    uriVariables: ['channelId' => new Link(...), 'taskId' => new Link(...)],
    read: false,
    write: true,
    contentNegotiation: false,
    deserialize: false,
    validate: false,
    extraProperties: ['_api_disable_swagger_provider' => true],
    processor: GetTaskProcessor::class,
)]
```

- `uriTemplate` is the entry's `mount` followed by the contract path, its placeholders named as on Symfony (ADR 0024 "Routes"), with Symfony's path refusals (`path.segment.literal.unsupported`, `path.segment.encoded.unsupported`, `path.segment.mixed.unsupported`).
- `name` is the Symfony target's route name, `seampact.<api>.<operationId>`, so the shared listener's route check and `<Api>RouteNames` hold unchanged. API Platform's `ApiLoader` uses the operation name verbatim as the route name (read from its source; the spike ran an underscored name).
- `defaults` carries the operation id under `_seampact_operation`, as the Symfony loader writes it.
- An action route (`/tasks/{taskId}/archive`) and a singleton are custom operations on their resource; the spike served both.
- The switches below the `defaults` are the same on every contract operation ("The check order"); `write: true` makes API Platform call the processor of a safe operation too.
- `stateless` is not generated: a contract operation keeps API Platform's own setting (`defaults.stateless`, true in its recipe), and an app whose identity reads a session sets it there.

The boundary still matches the raw path at `kernel.request` before routing, and answers a trailing slash, `//`, a dot segment, a method the path does not serve and an app route under the base path with the api's `notFound` 404, as ADR 0024 "Routes" says. API Platform's `route_prefix` is not used: the boot check refuses a contract route whose path is not the mount followed by the contract path.

### The operation marker

The Symfony listener finds the operation of a contract route from two facts: the route is the contract's (its name and its `_seampact_operation` default agree), and the method the router resolved carries `#[SeampactOperation]` with the same id. On API Platform the resolved controller is always `MainController`, so the listener never sees the handler's attribute and every contract route would throw `ContractBypassedException`.

The marker moves to the route default for this target: the subclass treats a contract route as marked by its name and default alone, and the bypass check that the attribute gave (a handler method reached through another route) moves to the generated processors, which refuse to run for a request whose stored operation is not theirs. The change is in the shared `php/symfony` runtime, an overridable read of the marker that the Symfony target keeps as the attribute; it needs a review on the shared runtime, and the Symfony suite stays green on it.

### The check order

Steps 1 to 8, the idempotency replay or claim and step 8b run where they run on Symfony, so before API Platform's whole chain: the spike observed `kernel.controller` before the deserialize provider, the `security` expression and the denormalization. API Platform's `security` expression then runs, from the access checker of its read step, on a request the contract already admitted and before the generated processor calls the handler. With `read: false` no object is read, so `object` is null in such an expression; it decides on the user, the request and the operation. Its `AccessDeniedException` extends Symfony's, so the shared exception roles already map it to `unauthenticated` or `forbidden`.

The generated operations turn off API Platform's own request handling with five switches on every contract operation:

- `read: false`: API Platform reads by default when an operation has path variables, and its read step answers 404 for a write with no provider, before the processor runs;
- `contentNegotiation: false`: negotiation would answer 406 for an `Accept` the operation does not list, where the contract ignores `Accept` (ADR 0024 "The reply path");
- `extraProperties: ['_api_disable_swagger_provider' => true]`: without negotiation the request format falls back to `html`, and API Platform's Swagger UI provider would replace the operation with its own page;
- `deserialize: false` and `validate: false`.

The contract alone decides an input, as on Symfony, where neither the Serializer nor `#[MapRequestPayload]` does (ADR 0024 "Types and validation"): API Platform's denormalization coerces types, does not keep `{}` apart from `[]`, and answers its own 400 or 422 for a body the contract accepts. The developer's method gets the boundary's typed input. `securityPostDenormalize` and `securityPostValidation` have no object to check without API Platform's deserialize, so the boot check refuses them on a contract operation, and any of the five switches changed ("The boot check").

### The reply path

The generated decorator of `api_platform.state_processor.main`, at a decoration priority between 100 and 200, sits between API Platform's write step (100) and its serialize step (200), where API Platform's own object-mapper processor sits at 150. It receives the generated result that the operation's processor returned through the write step and turns it into the contract reply with the boundary's own writer (`Replies::result`, the Symfony target's), and returns that `Response`. API Platform's serialize and respond steps never write a contract body, and the reply passes `kernel.response`, where step 10 runs the outgoing check, as on Symfony. The decorator handles only this api's generated results; any other value goes to the inner processor untouched.

A decorator at the default priority would run outside the write step and see the empty data before the write. The spike's second form, a generated processor that returns the rendered `Response` itself, also holds, since API Platform's serialize and respond steps pass a `Response` through; api-platform-2 keeps the decorator unless the suite shows otherwise. Either way the reply is the boundary's.

### Exceptions on contract routes

Generated exceptions are rendered by the boundary's `kernel.exception` listener at priority 128, before API Platform's error handling, as on Symfony. Every other exception is left to API Platform and the app, then mapped at `kernel.response` by the rules of ADR 0024 "Exceptions on contract routes". API Platform's own error body (with `description` and `trace`) and its 422 never reach a contract route: the mapping replaces them with the role's reply in the api's format, and a reply it cannot map is a violation of the outgoing check.

### Paging and IRIs

The handler returns the page result, as on Symfony, and the boundary writes the paging style's body. With the pack, that is the Hydra collection: `@context`, `@id`, `@type: Collection`, `totalItems`, `member` and `view` with `PartialCollectionView` and its links, without a `hydra:` prefix, as API Platform 5 writes it. API Platform's paginator never builds a contract page. Steps 6 and 7 refuse a `page` or `itemsPerPage` outside the contract before API Platform's chain runs, so the 500 API Platform's paginator gives a bad `page` is never reached.

`@id`, `$self` and `$itemSelf` are written by the boundary from the contract, never by `IriConverter`, so a nested item's IRI needs no parent id among the item's properties.

### The native look

The api's declared format is the wire, whatever it is: an API Platform api without the pack serves the default format, with problem+json errors. The JSON-LD and Hydra look comes from `@seampact/pack-api-platform`, never from API Platform. Two gaps against API Platform's wire are closed in this target's lane, the first in the pack, the second in the shared PHP renderer, not in the target:

- **Validation errors.** API Platform answers a failed validation with 422 and a `ConstraintViolation` body listing `violations` (`propertyPath`, `message`). The pack binds the `schemaInvalid` role to a 422 code whose params write that list from the issues, through `conventions.errors.derived` (grammar section 11), so a client written against API Platform reads the same body.
- **The item `@id`.** The pack writes `$self` and `$itemSelf`, which grammar section 13 defines as the member URL, built from `$id`, when the body is the collection's item with its id property, and the request URL otherwise. That member URL is the IRI API Platform gives the same item, parent path values included. Where the shared PHP renderer writes another URL for such a body (the request URL of a create or an action reply), the lane fixes the renderer, not the pack, since a pack change would move the wire of every target using the pack; the suite proves it. A body without its id property keeps the request URL: a known difference from API Platform, whose IRI needs that id.

Native rendering per framework stays a pack concern; the outgoing check judges the reply against the api's declared format on every target alike.

### Native security

The firewall, `access_control` and voters stay the app's, as ADR 0024 "Native security layers" has them: the per-kind request matchers, the `TasksAccess` table and the opt-in `VoterDecider` are the Symfony target's. API Platform's `security` expression on a contract operation runs after steps 2 to 8 and before the handler, with `object` null; the generated metadata sets none, and an app adds one through API Platform's documented metadata extension (a decorator of its resource metadata collection factory), the guide's example.

### Documents

API Platform's own OpenAPI document and its routes (`/docs`, the entrypoint, `/contexts/<Resource>`) stay as the app has them, the framework routes the boot check accepts by default; `frameworkDocs: off` turns them off ([A43](../decisions.md#a43)). Its document describes the generated resources' operations and paths. `nativeDocs`, which would complete that document with the contract's schemas and errors, waits for an app that needs it and is refused by name; seampact's own document is the complete one.

### The boot check

The Symfony target's boot check runs. Its container part is ADR 0024's less the value resolver, which this target does not register; the handler methods keep the api's `#[SeampactOperation]` attribute, so the check that every method of the implementing service carries it holds unchanged. Its route part runs on API Platform's routes (the routing-loader decorator sees them, since API Platform registers them through its own loader):

- every contract operation has exactly one route, named `seampact.<api>.<operationId>`, with its `_seampact_operation` default, whose path is the mount followed by the contract path, with no `host`, `schemes` or `condition`;
- no other route carries a `_seampact_operation` default of the api;
- no contract operation sets `securityPostDenormalize` or `securityPostValidation`, or changes `read`, `contentNegotiation`, `_api_disable_swagger_provider`, `deserialize` or `validate`, which an app's metadata extension could do;
- an operation's processor is the generated one, and no provider is set;
- API Platform's own routes are framework routes, accepted while its document is on; every other route under a base path follows `frameworkRoutes` (ADR 0011).

### App input rules

Step 8b is refused by name on this target in 1.1.0: the generator emits no `<Api>InputRules` interfaces for an API Platform api, and the boot check refuses a rules service tagged for one, naming the 1.2.0 release that brings them. The http-suite's input-rules case stays skipped by name on the API Platform consumer. When rules come, they run as on Symfony, at `kernel.controller` right after `IdempotencyStep::begin`, with the same `abandon` on a refusal: the spike found that place already before API Platform's deserialize, so no decorator is needed.

### The Laravel flavour

API Platform's Laravel flavour waits for a 1.2.0 release. It has the same shape: routes registered per operation from `uriTemplate` and `name`, wrapped in `ApiPlatformMiddleware`; `ApiPlatformController` runs the same provider and processor chains, so the decorators port. It differs in its security, a Gate `policy` checked after the data is provided, in its errors, through an `ErrorHandler` decorating Laravel's, and in its Eloquent-centred metadata. The Laravel target's boundary is middleware, which runs before the controller, so the access steps stay in front there too. Laravel's native 422 body is a `pack-laravel` concern of the same release.

### Refused by name or waiting

`generate` refuses by name, with its code and fix, everything ADR 0024 "Refused by name or waiting" lists, and on this target also:

| Waits for | What |
|---|---|
| on demand | API Platform 4 (refused by the compatibility matrix) |
| 1.2.0 | the Laravel flavour; app input rules |
| an app that needs it | `nativeDocs`; API Platform's `securityPostDenormalize` and `securityPostValidation` on contract operations; API Platform's own read, content negotiation, deserialize, validate, paginator and serializer on contract operations |

Worker runtimes are refused as on Symfony, by the same two guards.

### What the generated code depends on

At run time: `api-platform/symfony` 5 and the Symfony lines of ADR 0024 that it installs on, `seampact/symfony` for the boundary runtime, and `seampact/hooks` and `seampact/ir` as on Symfony, at the generator's version (ADR 0025). The matrix rows are the Symfony target's rows on which API Platform 5 installs; api-platform-1 records them.

### The consumer and the proof

The sample app lives in `scripts/consumers/targets/api-platform/`, a Symfony skeleton with API Platform 5 and the Symfony consumer's security setup, with the pack in its contract. Its workflow runs the Symfony consumer's jobs (the `node`-absent build, the boot step, the http-suite under php-fpm behind nginx) and ends with the lane's aggregate job. The proof is a green suite row per matrix entry, the input-rules case skipped by name, and the suite's JSON-LD and Hydra rows, the 422 violation body and nested item `@id` included.

### Delivery

| PR | Delivers |
|---|---|
| api-platform-1 | `php/api-platform`: the resources and operations with `uriTemplate`, `name`, `uriVariables` and the `defaults` marker; the per-operation processors and the five switches; the boundary subscriber subclass and the shared runtime's marker read; the boot check's route part; a golden for the reference contract; first proof that the real boundary serves an API Platform route |
| api-platform-2 | steps 2 to 8, idempotency and the input-rules refusal at `kernel.controller`; the reply decorator; API Platform's `security` after the boundary, its exceptions mapped |
| api-platform-3 | writes, paging and errors: the Hydra view, `@id`, `$self` and `$itemSelf` written by the boundary; the pack's 422 violation body and item `@id`; API Platform's error bodies replaced |
| api-platform-4 | the suite green on the consumer, `docs/backend/api-platform.md`, the conformance rows |

### The IR

None of the above changes the IR. The pack's formats and the golden IR already describe the JSON-LD and Hydra wire; everything here is generation, runtime and pack.

## Spike

Run on Symfony 7.4.23 and `api-platform/symfony` 5.0.6 on PHP 8.5.4, with in-process kernel requests, and not kept. A stand-in subscriber on the same kernel events and priorities as `BoundarySubscriber`, decorators of the provider and processor chains, and a voter logged their order. Not run: the generated boundary, the pack's renderer and the http-suite, which api-platform-1 proves first; API Platform 4; PHP 8.3; the Laravel flavour, read from its documentation only.

| Case | Result |
|---|---|
| order of `POST /tasks` with `security`, `securityPostDenormalize` and a constraint | `kernel.request` 512, the router, `kernel.controller` (controller `MainController`), the deserialize provider entered, `security`, the body denormalized, the `securityPostDenormalize` voter, validation, the processor, `kernel.response` |
| an unauthenticated call with `security` set | the exception thrown before the body was denormalized |
| `#[Get(uriTemplate, name, defaults, uriVariables)]` on a nested template, `debug:router` | the exact route name and path, no route loader; the defaults in the request attributes, seen by the provider |
| an action route and a singleton as custom operations | both served |
| API Platform's own JSON-LD and Hydra on a collection with `page` and `itemsPerPage` | the pack's members, no `hydra:` prefix; the nested item's `@id` built from resource properties |
| a bad `page` | 500 from API Platform's paginator |
| a validation failure; an error | API Platform's 422 `ConstraintViolation`; an error body with `description` and, in debug, `trace`, no `code` |
| a stand-in `kernel.controller` listener that reads a method attribute | `ContractBypassedException`, the controller being `MainController` |
| a `kernel.view` listener | never called |
| `#[AsDecorator]` on `state_provider.main`, `state_provider.deserialize`, `state_processor.main` | all three called; the deserialize decorator before the denormalization and with the object on return; the main processor decorator before write and serialize; priority 1000 innermost |
| `$request->getContent()` read at `kernel.controller`, then API Platform's deserialize | the same bytes both times |

## Consequences

- App input rules ([ADR 0028](0028-app-input-rules.md)): API Platform: refused by name in 1.1.0; in 1.2.0 step 8b runs at `kernel.controller` after the idempotency claim, as on Symfony.
- An app moves its handlers between the Symfony and API Platform targets unchanged; API Platform gives it its routing, its document and its security glue.
- The wire on an API Platform api is the contract's, through the api's format; the JSON-LD and Hydra look needs the pack, and a client written against API Platform reads the same bodies once the pack's two gaps are closed.
- API Platform's read, content negotiation, deserialize, validation, `securityPostDenormalize`, `securityPostValidation`, paginator and serializer cannot be used on a contract operation; its `security` runs before the handler with `object` null.
- The shared `php/symfony` runtime gains an overridable marker read; the Symfony target keeps the method attribute.
- ADR 0012's api-platform row is amended to match: the developer writes the api's generated handler interfaces, as on Symfony, and generated processors call them, a safe operation's included; steps 2 to 8 run in the Symfony target's `kernel.controller` listener, which finds the operation from the route's `_seampact_operation` default, not from `_api_operation_name`; no deserialize decorator; a generated decorator of the main processor writes the reply.
- ADR 0010 "API Platform spike" is answered: `security` runs after the boundary's steps; the item `@id` is the boundary's; the restricted input field is refused by step 7 before any denormalization; validation answers the contract's `schemaInvalid` role, 422 with the pack; the context and document routes are framework routes; the operation comes from the route default; Symfony now, Laravel in 1.2.0.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, handlers stay the developer's), FR-21 (PHP targets), FR-25 (framework routes and the boot check), FR-35 (the shared suite); amendments A15, A28, A30, A32, A40, A41, A43, A47.
- ADRs: 0008 (the pack), 0009 (artefacts, matrix), 0010 (artifacts, the API Platform spike), 0011 (app config), 0012 (placement and obligations), 0016, 0023 and 0024 (the shared obligations and the Symfony target this one runs on), 0025 (runtime packaging), 0028 (app input rules).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the API Platform consumer.

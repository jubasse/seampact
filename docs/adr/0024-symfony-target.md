# ADR 0024: The Symfony server target

Status: accepted, delivered by symfony-1 to symfony-4

## Context

ADR 0012 fixes what every server target generates around the developer's controller, places the symfony steps in its target table and lists the symfony obligations. ADR 0016 fixes the rules this target meets in PHP: the check order, a reply written by the boundary, exceptions handled narrowly, the outgoing response check and its `responses` modes, the body limit, query decoding and the bounded values. `seampact/symfony` (ADR 0010 "Native artifacts") generates, per api of the app config, PHP that places those checks around the developer's controllers in a Symfony application. `vendor/bin/seampact generate` and `bin/console seampact:generate` run it, and the app builds on a machine without Node ([A9](../decisions.md#a9)). This ADR states where each step runs in Symfony, how each obligation is met, what the developer can turn off, and what waits. What it does not restate holds as ADR 0016 and ADR 0023 (the Laravel target, which shares PHP's decoding and HttpFoundation) say.

Six Symfony behaviours shape the placement:

- `HttpKernel` dispatches `kernel.request` listeners by priority: `ValidateRequestListener` at 256, `SessionListener` at 128, `RouterListener` at 32, then the security firewall at 8, which runs `access_control` and the authenticators after routing. `kernel.controller` runs once the controller is known, before any argument is resolved; `kernel.controller_arguments` runs after argument resolution.
- Every reply goes through `kernel.response` on the same `Response` object before `send()`: a controller's reply, a `kernel.view` listener's reply, a reply set by a `kernel.request` listener, and an exception's reply, whether a `kernel.exception` listener set it or `ErrorListener` (priority -128) rendered it through the error controller.
- The controller is resolved by service id. `ControllerEvent::getAttributes()` reads the attributes of the resolved controller's method.
- The router matches the percent-decoded path, redirects a trailing slash with a 301 on `GET` and `HEAD`, and answers 405 for a method the path does not serve. `Request::getPathInfo()` is the raw path minus the front controller's own base path, never the forwarded prefix.
- The container is compiled once and cached; the routes are loaded by the routing loaders and compiled into a separate router cache. `%env()%` values are resolved at run time, never at compile time.
- An app boots per request (php-fpm) or once per worker (FrankenPHP worker mode through the Runtime component, which sets `APP_RUNTIME_MODE` to `web=1&worker=1`).

## Options

- Symfony majors: 7.4 LTS and 8.x, or 8.x only. Choice: both. 7.4 is the LTS line, 8.x the current one, and the spike found no difference between 7.4.21 and 8.1.9 on any case below. 7.3 and older are recorded as incompatible in the compatibility matrix, so `generate` refuses them by name (ADR 0009 "Artefacts and the compatibility matrix"). Symfony 8 needs PHP 8.4, so the PHP 8.3 rows run 7.4 only.
- Step 1 and the outgoing check: in the `kernel.controller` listener, in a decorator of `http_kernel`, or in a `kernel.request` listener placed before routing with a `kernel.response` listener placed last. Choice: the two listeners. The `kernel.request` listener sees the raw path before `RouterListener` and the firewall, and the `kernel.response` listener receives every reply of the kernel, the replies rendered from exceptions included (spike). A kernel decorator is not idiomatic and changes the app's `http_kernel` service.
- Steps 2 to 8: in the `kernel.controller` listener of ADR 0012, in a value resolver that validates, or in a `kernel.controller_arguments` listener. Choice: the `kernel.controller` listener, as ADR 0012 says. It runs after the firewall, so a hook reads the user from the token storage, and before argument resolution, so `#[MapEntity]` and the other value resolvers never run before access and validation (spike).
- Step 6: `#[MapRequestPayload]` with Validator constraints on a denormalized class, every check generated, or generated structural checks with Symfony's own value constraints. Choice: the last. `#[MapRequestPayload]` denormalizes through the Serializer, which coerces types and answers a failed validation with 422; the decoded tree must keep `{}` apart from `[]` and accept `1.0` as an integer ("Types and validation").
- Schema classes: plain, or with Symfony Validator attributes for the app's own `validate()`. Choice: the attributes whose Symfony meaning is the contract's, as Spring puts Jakarta constraints on its records: `NotNull` on a required member that is not nullable, `Valid` on a member holding objects, `Length`, `Count`, one comparison per bound, `DivisibleBy` and `All` for list items, and `Regex` with the boundary's modifiers for the rules mode, beside `NotEqualTo('')` when the pattern refuses the empty string, which `Regex` passes unchecked. The `uuid` format (Symfony's `Uuid` refuses RFC 9562 text the contract takes), enums and `date-time` (held by their PHP types, so a length or pattern on a `date-time` member is left out too), opaque values and a member both optional and nullable (its `Field` wrapper) get none. A bound, step, pattern or `date-time` length no attribute can write is left out and named in the class's docblock, never refused, so the attributes never stop a contract from generating. The boundary never reads them: step 6 stays the generated constraint on the decoded tree.
- Reply path: a `kernel.response` listener that rewrites the handler's reply, or generated results turned into the reply by a `kernel.view` listener. Choice: `kernel.view`; Symfony dispatches it for any controller return value that is not a `Response`, and the boundary writes the reply with its own encoder (spike).
- Framework refusals: one `kernel.exception` listener that renders every exception on a contract route, or the framework's own handling with a mapping on the way back. Choice: generated exceptions rendered by the boundary's `kernel.exception` listener; every other exception left to the firewall's `ExceptionListener`, the app's listeners and `ErrorListener`, then mapped at `kernel.response` from the exception the boundary recorded at `kernel.exception` or from `LoginFailureEvent`. The firewall's entry points and the app's listeners keep working, and the app's renderers see every exception (spike).
- The boot check: in a compiler pass, in a non-optional cache warmer, or in a compiler pass for the container with a decorator of the routing loader for the routes. Choice: the pass and the decorator. A compiler pass cannot see the routes, which the router loads apart from the container. A failing pass writes no container, and a failing route check writes no router cache, so in both cases the app does not serve (spike). A cache warmer runs only once the container is written and only when the container is rebuilt.

## Decisions

### Placement

The developer writes controller services implementing the api's generated interfaces (ADR 0007 `handlers`, `TasksEndpoints`) and marks each method with the generated attribute. Each method takes the operation's generated input:

```php
final class TasksController implements TasksEndpoints
{
    #[SeampactOperation('updateTask')]
    public function updateTask(UpdateTaskInput $input): UpdateTaskResult { ... }
}
```

Codegen emits, per api, under the target entry's `out`, in its PSR-4 namespace:

- **Per operation**: the input class, the result classes, one exception class per code, and the operation's generated constraint (`UpdateTaskInputConstraint`) with its validator.
- **The boundary subscriber** (`TasksBoundary`), one event subscriber with the listeners below. Step 1, the routed marker, the exception record and the outgoing check act on the main request only, so the sub-request through which `ErrorListener` renders an exception, and a fragment's sub-request, are neither matched again nor checked twice:
  - `kernel.request` at priority 512, after `DebugHandlersListener` and before `ValidateRequestListener`, the session, `RouterListener` and the firewall. It runs step 1: the request context, the raw-path match of "Routes" below, the media type, the bounded body read and the decoding. It answers its own refusals in the api's format and stores the match in a request attribute under a generated name. It reads the body only when the raw path matches an operation that takes one. It also counts the main requests its container instance has seen, for the worker guard of "Refused by name or waiting".
  - `kernel.request` at priority 31, right after `RouterListener`, which marks that routing ran.
  - `kernel.controller` at priority 0, which runs steps 2 to 8 (below) and stores the typed input in a request attribute; its fail-closed checks also run on sub-requests ("Types and validation").
  - `kernel.view` at priority 0, which writes the reply of a generated result ("The reply path").
  - `kernel.exception` at priority 2048, which records the first exception of the request, and at priority 128, which renders the generated exceptions ("Exceptions on contract routes").
  - `LoginFailureEvent`, which records an authenticator's exception as the request's exception, since an authenticator's failure reply never reaches `kernel.exception`. SecurityBundle copies a global listener of that event onto every firewall's dispatcher.
  - `kernel.response` at priority -2048, after `SessionListener` (-1000), which runs the outgoing response check and the mapping of framework refusals.
- **The input value resolver** (`TasksInputResolver`), tagged `controller.argument_value_resolver` at priority 150, above `RequestAttributeValueResolver` (100). For a parameter typed with one of the api's input classes, it returns the input the `kernel.controller` listener stored, and nothing else.
- **The route loader** (`TasksRouteLoader`), tagged `routing.loader`, which registers each operation ("Routes").
- **The registration**: one bundle per api (`TasksSeampactBundle`), which the app lists in `config/bundles.php`. Its extension registers the services above, and its compiler passes:
  - find the one service definition implementing each generated interface, tag it `controller.service_arguments` and register the interface id as a public alias, so the routes can name the interface (spike). This pass runs at `TYPE_BEFORE_OPTIMIZATION` with priority 1, before Symfony's own pass that registers controller arguments; an interface with no implementer or several is left as is, for the boot check to refuse;
  - run the container part of the boot check ("The boot check").

  Its `boot()` refuses a declared worker runtime ("Refused by name or waiting").

The routes point at the interface (`TasksEndpoints::updateTask`), which the container resolves to the implementing service (spike). Each route is named `seampact.<api>.<operationId>` and carries the operation id in its defaults, under `_seampact_operation`.

The generated types go into the PSR-4 namespace `composer.json` gives the entry's output directory, which the runner derives (ADR 0010 "Namespaces"), so no option names it; the schema types go into its `Schemas` sub-namespace. The Symfony placement goes into its `Symfony` sub-namespace, with the api's own `SeampactOperation` attribute and `Decider`, `ScopeResolver` and `UnexpectedErrorListener` interfaces, which extend the runtime's so that the boundary, the autoconfiguration and the listener lookup match one api's classes only; no runtime is generated: the code imports it from the installed packages (ADR 0025). A declared schema `UpdateTask` and a placement class never share a namespace. Fixed class names that ADR 0007 has no role for are Pascal-case words prefixed by the api's type name, and constants are upper snake case (`MAX_CHECKED_ERROR_BODY_BYTES`).

The handler method returns the operation's generated result: an interface implemented by one final class per declared success status and by the typed error result (ADR 0007 `errors` role). It may instead throw one of the generated exceptions, declared with `@throws` on the interface method (ADR 0012 "Errors the handler answers"). A decide hook that throws Symfony's `AccessDeniedException` (`denyAccessUnlessGranted()`) answers the requirement's first declared denial code. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").

### Routes

Patterns use Symfony's syntax, each placeholder named after its input property (`/v1/tasks/{taskId}`), so the router builds a URL by name; a name longer than the 32 characters of the route compiler keeps a positional name (`{p2}` for the second placeholder), as on Laravel. The boundary still matches the raw path. A `:` inside a static segment is literal (`/v1/tasks:batch`, spike). `generate` refuses by name:

- a static segment holding `{`, `}` or `?` (`path.segment.literal.unsupported`);
- a static segment a client sends percent-encoded, one holding a space, a control or non-ASCII byte, `"`, `<`, `>`, `^`, `` ` ``, `\`, `{`, `}`, `|`, `[` or `]` (`path.segment.encoded.unsupported`), since the boundary answers such a raw path 404 ("Routes"), until a consumer needs one;
- a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`), as on Laravel, Spring and the Node targets.

The router matches routes in registration order, so the loader registers, per path depth, literal segments before placeholders: `/v1/tasks/search` before `/v1/tasks/{taskId}` (spike). The app imports the routes from its own routing configuration, once per api, with the api name as the resource:

```yaml
# config/routes/seampact.yaml
seampact_tasks:
    resource: tasks
    type: seampact
```

Each api's loader supports the `seampact` type for its own api name only, so two apis load apart. The loader writes each contract path under the entry's `mount`, and the routing import takes no `prefix`: the boot check refuses a contract route whose path is not the mount followed by the contract path, and an import `host`, `schemes` or `condition` on a contract route too. The runner passes `frameworkRoutes` to the generator through the target entry.

The `kernel.request` listener matches the raw path, `getPathInfo()`, against the contract templates. That path is the request target without the query, minus the front controller's own base path; a trusted `X-Forwarded-Prefix` does not change it (spike). The `kernel.controller` listener then compares the operation of the route the router chose with that match. The router decodes the path before matching, so the two can differ:

- `/v1/tasks/%73earch` reaches the search route while the raw path matches `{taskId}`. The listener answers the path's `notFound` 404 before any check (spike).
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the `kernel.request` listener, before routing, on every Node target's terms (ADR 0016 "Errors raised before routing"). This covers a trailing slash, which the router would redirect, `//`, a dot segment (`x/../7`, `%2e%2e`), a percent-encoded static segment, a segment holding a `;` path parameter (`7;x=1`), and an app route under the base path that the contract does not declare (spike).
- `a%2Fb` in a segment matches `{taskId}` raw, but the router matches the decoded `a/b` and finds no route, or an app route. On the way back, and only once routing ran (the marker after `RouterListener` is set, or the router raised its not-found or method-not-allowed exception), the `kernel.response` listener reads the chosen route (`_route`). When it is not the contract route of the operation that the raw path matched, the listener answers that path's `notFound` 404, whatever the reply (spike). A reply given before routing (the boundary's own, a `ValidateRequestListener` 400) keeps its status.
- A segment whose percent-decoding is not UTF-8 (`%E0%A4%A`) is answered by the `kernel.request` listener as ADR 0016 answers a path value that does not decode: the `schemaInvalid` 400 with that parameter's issue, without running steps 2 to 5 (spike).
- `catchAll: false` leaves those paths to the app. The boot check refuses an api when another api's bundle, listed before it, has `catchAll` on and a base path that is empty, equal to or a prefix of this api's, since that api's 404 would answer this api's paths; set `catchAll: false` on the earlier api.

Other methods:

- `HEAD` runs the path's `GET` operation fully, and `Response::prepare()` drops the body.
- A method the path does not serve answers the path's `notFound` 404 from the `kernel.request` listener, where the router would answer 405 (spike).
- A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's CORS listener, such as NelmioCorsBundle's, which runs after the boundary.

Beside the route loader, the shared `RouteHelpers` of `php/codegen` writes `<Api>RouteNames`, one constant per operation holding its route name, and `<Api>Urls`, one static method per operation taking one typed argument per path parameter in path order and returning the contract path, each value written as one segment by `WireValues::pathSegment` (its wire text, a number as JavaScript writes it, `encodeURIComponent`-encoded as the generated clients send it; an empty, `.`, `..` or non-UTF-8 value refused) and each static segment as the contract writes it, never prefixed (the boot check refuses a prefix while `mount` waits) and never absolute; `artefacts.routeHelpers: false` leaves both out.

### The reply path

Every result class is turned into the reply by the `kernel.view` listener, and every generated exception by the `kernel.exception` listener; both write the contract reply themselves:

- a `Response` with its status, headers and body, serialized by the boundary's own `json_encode` call (`JSON_THROW_ON_ERROR`, `JSON_UNESCAPED_SLASHES`, `JSON_UNESCAPED_UNICODE`, `JSON_PRESERVE_ZERO_FRACTION`), never the Serializer, a normalizer or a `JsonResponse` default;
- one path for a 2xx among several, the derived 304 with the boundary's strong ETag, an idempotent replay and every contract error.

Content negotiation is not consulted. A client's `Accept` and the request format change nothing that the contract does not say. The boundary records each reply it writes, so the outgoing check can tell it from a reply the app wrote.

### Exceptions on contract routes

A generated exception is rendered by the boundary's `kernel.exception` listener at priority 128, before the firewall's `ExceptionListener` (1), the app's listeners at the default priority and `ErrorListener` (-128). An app listener at priority 0 that renders every exception did not change it (spike). An app listener placed above 128 that replaces it is the app's choice; the outgoing check judges the result.

Every other exception is left to Symfony and the app, untouched: the firewall's entry point or access-denied handler, an authenticator's `onAuthenticationFailure()`, the app's `kernel.exception` listeners, then `ErrorListener` and the error controller. The boundary records the first exception of the request, from its `kernel.exception` listener at priority 2048 or from a `LoginFailureEvent` listener at the lowest priority, and only when that event ends with a reply (`getResponse() !== null`): an authenticator that returns no reply (remember-me, x509, `remote_user`, a custom one) lets the request go on, and nothing is recorded. The `kernel.response` listener maps only a reply the boundary did not write. A recorded failure is an authenticator's failure (`http_basic` or `json_login` with bad credentials, an `access_token` or custom authenticator refusing) that returns its reply from `onAuthenticationFailure()` without reaching `kernel.exception`. The `kernel.response` listener answers, in the api's format, with the role of the first row that matches:

- `TooManyLoginAttemptsAuthenticationException` (the firewall's `login_throttling`), RateLimiter's `RateLimitExceededException` (from `ensureAccepted()`) and `TooManyRequestsHttpException`: `rateLimited` (429), with `Retry-After` from the exception when it carries one (`getRetryAfter()`, a date written as the whole seconds from now, rounded up and never below 0, or the HTTP exception's header as is), and no `Retry-After` when it carries none, read first since the login-throttling exception extends `AuthenticationException`;
- `InvalidCsrfTokenException` (from a CSRF token manager in an app's authenticator or listener): `csrfInvalid` (403), read before the next row since it extends `AuthenticationException`;
- `AuthenticationException`, or an `AccessDeniedException` that the firewall answered with its entry point (a 401 or a redirect to the login page): `unauthenticated` (401) (spike, `http_basic`);
- an `AccessDeniedException` answered with a 403 (`access_control`, a voter that app code calls): `forbidden` (403) (spike);
- any other `HttpException` that a handler, an app listener or a value resolver throws (`UnauthorizedHttpException`, `AccessDeniedHttpException`, `createNotFoundException()`, a `MapEntity` miss, `new HttpException(429)`): the role of its status, `unauthenticated` (401), `forbidden` (403), `notFound` (404), `rateLimited` (429) or `serviceUnavailable` (503), as the Laravel target maps `abort()`.

Each of them answers by one rule, shared with every server target (ADR 0016): the code of its role when the operation declares one; else, for an `HttpException`, the operation's single code of that status; either one with the params its role binding renders from the role's data (IR section 7) when they hold every required param, or without params when that code declares no required one (a param with a default is not required); else the api's 500, logged. The `rateLimited` role's data is `retryAfterMs`, the delay of the first usable `Retry-After` of the delay the exception carries through `getRetryAfter()` (`RateLimitExceededException`, `TooManyLoginAttemptsAuthenticationException`), then the framework's reply, then of the exception's own headers, in delta-seconds (capped at 9007199254740991 ms) or any of RFC 9110's three HTTP-date forms read as UTC (a past date is 0). It fills `retryAfterMs` of `api.rate_limited`, required or optional, whether or not a bucket rule declares a retry header; without a usable value, a code that requires it is the 500 too. An `HttpException` of any status is mapped this way, even when an app listener wrote a reply for it.

`#[IsGranted]` and `#[IsCsrfTokenValid]` are not among these layers: their listeners run at `kernel.controller_arguments`, after steps 6 to 8, so a caller without access would get step 6's issues first, against the check order (FR-5). The boot check refuses them on a contract method ("The boot check").

The security and RateLimiter classes are named in `instanceof` checks only, which need neither package installed. The boundary's internal exception ("Types and validation") is the api's 500 with `onUnexpectedError` called. Any other exception's reply is checked as written, below. An exported `renderContractError($request, $throwable)` for an app's own listener waits for a consumer that needs it.

### The outgoing response check

The `kernel.response` listener checks the reply of each contract route. That reply comes from whichever writer:

- the boundary's own results and exceptions;
- the app's `kernel.exception` listeners and `ErrorListener`, in HTML or, with the Serializer installed and a JSON request format, in problem+json (spike);
- the firewall's entry points and handlers;
- a handler that returned its own `Response`, `JsonResponse`, `StreamedResponse` or `BinaryFileResponse`, for which Symfony dispatches no `kernel.view`.

The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's, applied as ADR 0023 "The outgoing response check" applies them on the same HttpFoundation:

- **A declared success** that the boundary wrote passes. A streamed success comes only from a generated result (a download, which waits for a consumer), passed with its callback wrapped only to catch a failure.
- **An undeclared status** is a violation before any byte is sent, streams included.
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A body in `gzip` or `deflate` is decoded first; a `br` error body is a violation, a parity gap listed in Consequences. A streamed error body is buffered by running its callback into the held bytes before the verdict, and the reply is then replaced by a `Response` holding those bytes, since a `StreamedResponse` refuses `setContent()` and its callback runs once. A `BinaryFileResponse` error body is read from its file, at most one byte past the cap, and replaced the same way.
- **A reply the boundary did not author.** On a contract route:
  - a success status (a 2xx or a 304) that the boundary did not write is a violation: a handler that returned its own `JsonResponse` (spike) or its own stream;
  - once the `kernel.controller` listener admitted the request, a reply that is neither the boundary's nor the rendering of an exception is a violation.
- **An ETag** that the boundary did not set is stripped, and a 304 that it did not write is a violation (`frameworkEtag: strip`, the default). `#[Cache(etag: ...)]` on a contract method sets its ETag on the boundary's reply object during `kernel.response`, before the check (not run), so the boundary compares the header with the value it wrote.
- **A changed authored reply.** The boundary recognises its reply by object identity, and later listeners can change that object. It records the status and the body bytes it wrote and judges a reply whose status or body differs as one it did not author. On `HEAD`, `ResponseListener` empties the body in `Response::prepare()` before the check, so only the status is compared (spike).

Under `strict` a violation is replaced by the api's 500, and `onUnexpectedError` is called. A failure inside a stream's callback, after the headers are sent, cannot be replaced: it is logged, `onUnexpectedError` is called and the body ends short. Under `warn` the reply goes out as written, and the violation is logged once.

The limits are those of ADR 0016: a writer that bypasses the response (`echo` from the handler, `header()`, `exit` or `die`, `dd()`) is not seen. An exception thrown inside `Response::send()` or by a `kernel.response` listener after the check is not seen either. A reply set by an app `kernel.request` listener placed above 512, or changed by an app `kernel.response` listener placed below -2048, escapes the check; the boot check refuses both when they are registered in the container, and a listener the app adds at run time with `addListener()` is not seen. An `HttpCache` that the front controller wraps around the kernel by hand (`new HttpCache($kernel)`, the recipe before Symfony 6) serves stored replies without the boundary and is not seen either; the boot check sees only `framework.http_cache`, and the Symfony guide says so. The profiler's `ProfilerListener` (`kernel.response` at -100) captures the reply before the check, so the profiler shows the reply as written, not the 500 that replaces a violation; the guide says so too.

### Errors raised before the boundary

Before the `kernel.request` listener, only the web server, PHP, the Runtime and `DebugHandlersListener` run: the web server's body limit (nginx `client_max_body_size`), PHP's `post_max_size`, and a failure while the kernel boots. The boot check requires the boundary's listeners at their priorities.

Between step 1 and the `kernel.controller` listener, `ValidateRequestListener` (conflicting forwarded headers, a 400), the session, the app's own `kernel.request` listeners, the router and the firewall run. The router's 404 and 405 never answer a contract path, which step 1 has already matched or refused. The firewall's refusals, an authenticator's failure included, and the others' exceptions are mapped as "Exceptions on contract routes" says; a refusal the mapping does not name is checked as written.

### Types and validation

Generated value types are ADR 0023's:

- `final readonly` classes for objects;
- an abstract base class with one final class per variant for unions, with an `Unknown` variant only on input readers;
- backed enums;
- `?T` for an optional or a nullable member, and `seampact/hooks`'s `Field` for a member both optional and nullable (CHK-158);
- `DateTimeImmutable` for a `date-time`, kept with its offset;
- integers as `int` in the IR's safe range, checked as whole numbers, so `1.0` is an integer; a JSON integer above 2^53 - 1 in magnitude is refused as `maximum`, or `minimum` below zero, whether it decodes to an `int` or a float, as on the Node targets (ADR 0003).

Wire names that differ from the PHP property name are carried by the generated decoder and encoder; no Serializer attribute is needed.

The boundary decodes the held body with `json_decode($bytes, false, 512, JSON_THROW_ON_ERROR)`, objects preserved: a body that does not decode as UTF-8 JSON, or nests deeper than 512, is the malformed 400 of step 1. So is a valid body with an object key that starts with a NUL byte (`{"\u0000a":1}`), which PHP cannot hold as a property name, a parity gap listed in Consequences. Path, query and headers are decoded by the IR's wire form. The `kernel.controller` listener then runs:

1. **The fail-closed checks**, before any hook or input is read. The listener reads the operation from three places: the attribute on the controller's method (`ControllerEvent::getAttributes()`), the chosen route's `_seampact_operation` default, and step 1's raw-path match.
   - An attribute without a contract route (an app route to a contract action, spike) or a contract route whose controller method lacks the attribute throws the boundary's internal exception: the api's 500 with `onUnexpectedError` called.
   - A contract route whose operation differs from the raw-path match answers that path's `notFound` 404 (spike).
   - The value resolver returns only an input the listener stored for that operation. A request that never passed the listener (a sub-request from `forward()` or `render(controller())`, a test that calls the method directly) throws the internal exception. The Symfony guide says so for functional tests.
2. **Steps 2 to 5**: authenticate, principal requirements, scopes and requirements, with the hooks of "Options and registration".
3. **Step 6**: the operation's generated constraint, run through the app's `validator` service on the decoded tree. Per member:
   - it reads presence with `property_exists` or `array_key_exists`, so an explicit `null` and an absent key never look alike, and a required member is present;
   - it checks the member's type on the objects-preserved tree (no coercion, `{}` versus `[]`, whole numbers);
   - only when the type passes, it runs the member's value constraints at that member's path, as `Sequentially` does, so a type issue is the member's only issue.

   Unknown keys, `enum`, `const`, `oneOf`, the discriminator and `uniqueItems` are generated constraints: Symfony's `Choice` compares with `===` and refuses `1.0` for an integer `1`, and `Unique` passes `[1, 1.0]` (spike). A nullable member needs no extra constraint, since every Symfony value constraint passes `null` (spike), and a `null` on a member that is not nullable fails the type check first. The body is decoded without `JSON_BIGINT_AS_STRING`, which would turn a large JSON number into the same string as a JSON string, so a JSON integer beyond the `int` range decodes to a float: it is a type issue on a string member, including an `int64` or `decimal` member carried as a string, and read as a float on a `number` member. On an `integer` member, the type check accepts a float (`is_float()`) only when it is whole and its magnitude is at most 2^53, such as `1.0`: a whole float whose magnitude is at least 2^63 (so -2^63 too, since `-9223372036854775809` decodes to a float equal to `PHP_INT_MIN`) is 400 `maximum`, or `minimum` below zero, as on the JVM and Laravel, and a whole float of smaller magnitude above 2^53 is refused the same way, since its value may have changed in the decode; a JSON integer that fits an `int` decodes to an `int` and is never a float.

   Each violation carries its contract rule name in the constraint's `payload`, read back with `getConstraint()` (spike), so each issue is `{ in, pointer, rule }`; Symfony's message is never rendered or logged, since it can quote the value. The issues are bounded by `MAX_RENDERED_ISSUES = 100`. A failure throws the generated `schemaInvalid` exception: the 400, never a 422.
4. **Steps 7 and 8**, then the typed input, stored in a request attribute under a generated name for the value resolver.

The target takes `rules` (ADR 0009), as the Laravel target does:

- **`native`, the default.** A value rule renders as Symfony's own constraint wherever Symfony has one: `Length` on strings (counted in code points, as the contract counts, spike), `Count` on arrays, one comparison constraint per bound on members carried as JSON numbers (`GreaterThanOrEqual`, `LessThanOrEqual`, `GreaterThan`, `LessThan`, never `Range`, so each violation carries its own rule), `DivisibleBy` for `multipleOf`, and `Regex` (with the `u` modifier; a search, spike). The `uuid` format stays generated in both modes: Symfony's `Uuid` refuses RFC 9562 text that ADR 0003 accepts (the nil and max UUIDs, version digits outside 1 to 8, variant digits outside 8 to b), and a native constraint that raises several violations for one rule gives one issue. `multipleOf` is the exact integer step that ADR 0003 keeps on `integer` (`2.5` gives 5, as on the Node targets); a step on a `number` is refused as an inconsistent IR, and a step beyond the PHP `int` range waits for a consumer after 1.0. A format other than `uuid` and `date-time` is refused by name (`format.string.unsupported`), as the shared form walk refuses it for Laravel, and `int64` and `decimal` wait for a consumer after 1.0 (`format.wide.unsupported`): a number constraint would compare their decimal text as a float (`Range` passed `"9223372036854775808"` under a `PHP_INT_MAX` maximum, spike). `date-time`, which Symfony has no constraint for, stays generated. The Symfony guide lists the differences in a few lines (`Regex` on PCRE).
- **`seampact-consistent`.** Every value rule is a generated constraint with ADR 0003's meaning, patterns searched as ECMA-262 does through the normalised pattern of ADR 0003 section 9, rendered for PCRE with the `u` and `D` modifiers.

`Regex` passes an empty string without checking it, as `Email`, `Url`, `Uuid` and `Ip` do, while `Length` checks it and counts whitespace (spike). Under `native`, a string member with a pattern therefore also gets a generated check that applies the pattern to `""`, so an empty string never passes a `pattern` unchecked; a string of spaces reaches `Regex`, which checks it.

The contract input is the boundary's decoding. `$request->getContent()`, `getPayload()` and `toArray()` keep their Symfony meaning for app code: `getContent()` returns the bytes as received after the boundary's streamed read (spike), and the compressed bytes for a `gzip` or `deflate` body.

### Query and bounded values

- **Query.** Decoded from the raw `QUERY_STRING` by the IR's wire form, with form decoding (`+` is a space), never from `$request->query`, since PHP's `parse_str` turns `.` and spaces in a name into `_` and reads `a[]` as an array. Zero body bytes is no body. The media type is matched exactly.
- **Body limit.** The boundary refuses a declared `Content-Length` above the route's limit before reading. It reads the body in chunks through `getContent(true)`, decodes `gzip` and `deflate` with ext-zlib's `inflate_add`, counts both the encoded and the decoded bytes, and answers the route's 413 as soon as either passes the limit, chunked bodies included (spike, CLI server).
  - Any other content coding answers 415; a corrupt compressed body is the client's 400.
  - The boundary's input, and a signed route's raw body, are the decoded bytes.
  - The web server's limit and `post_max_size` must be at least the largest route limit; the Symfony guide says so. The target exports no limit constant.
- **Paging.** The paging roles, `overLimit` included, are validated in step 6. Symfony has no paginator of its own, so no paging style of a pack applies; the handler answers the contract's page shape.
- **Throttle.** The throttle hook reads its bucket through a RateLimiter factory service that the app configures (`framework.rate_limiter`), keyed by the boundary's bucket key (symfony-3).
- **Keys.** The throttle bucket key and the idempotency key are fixed-size SHA-256 digests with the same bytes, hex and base64url text as the Node, Spring and Laravel targets, so keys and ETags are equal across targets. The idempotency key is derived as ADR 0012 obligations say, never from the credentials.
- **Version tokens.** The boundary validates the expected version with the body; the handler compares it with the stored version and answers the operation's `stateConflict` error, as on the other targets.
- **Absolute URLs.** Under `api.wire.urls: absolute`, every URL starts with the configured public origin, the bundle's `public_origin` value ("Options and registration"). The request host and forwarded headers are never read. Trusted proxies stay the app's own `framework.trusted_proxies` and `trusted_headers` settings; they change Symfony's URL generator, never the boundary.

### Redaction

Every generated class that holds one of the values below gets a generated `__debugInfo()`, and its constructor marks that parameter `#[\SensitiveParameter]`:

- `AuthenticateRequest`'s credentials;
- the CSRF token;
- the members of each identity's generated credentials class;
- a signed request's body, raw and parsed, and its signature header;
- a `sensitive` member.

Each is printed as the generated `[redacted]` constant (ADR 0012 obligations, CHK-168).

- `var_dump` and `print_r` read `__debugInfo()`; stack traces omit the `#[\SensitiveParameter]` values.
- Symfony VarDumper, behind `dump()`, `dd()` and the profiler's request panel, which dumps the request attributes holding the typed input, prints the real properties next to `__debugInfo()`. The bundle's `boot()` registers a caster for the generated classes in `AbstractCloner::$defaultCasters`, which hides them there, as on Laravel.
- `var_export`, `json_encode` and an `(array)` cast still show them; the Symfony guide says so.

The boundary's own logs, written to the app's PSR-3 logger, carry the operation id, the rule and the pointer, never an input value or a Symfony violation message. A logged pointer is cut to `MAX_LOGGED_POINTER_BYTES = 256` on a UTF-8 boundary, with its control characters escaped.

### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `handlers`, `perResource` only: `perOperation`, one interface per operation for an `__invoke` controller, waits for an app that needs it (`options.handlers.unsupported`);
- `indent`;
- `rules` (`native`, the default, or `seampact-consistent`);
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`).

The naming options of ADR 0007 (`suffixes`, `escape`, `enumCase`) are refused by name (`options.naming.unsupported`): the target names PHP with the ADR 0007 defaults, which the shared naming vectors test. `layout` is refused too (`options.layout.unsupported`): one file per class under the PSR-4 directory is the only layout Composer loads. `namespace` is no option: the runner derives it from PSR-4, and the key is refused as unknown. These options are the same on every PHP target, read by `seampact/codegen`.

At run time, the generated code reads the bundle's configuration, under the extension alias `seampact_<api>`:

```yaml
# config/packages/seampact_tasks.yaml
seampact_tasks:
    responses: '%env(default:seampact.tasks.responses:SEAMPACT_TASKS_RESPONSES)%'
    body_validation: false
    operations:
        updateTask: { responses: warn }
    public_origin: '%env(SEAMPACT_TASKS_PUBLIC_ORIGIN)%'
```

- `responses` and `body_validation` for the api;
- `operations.<operationId>.responses` per operation; an operation id the api does not declare fails the container build, naming it and the declared ids;
- `public_origin`.

An operation's value wins over the api's value, which wins over the target option. Every value may be an `%env()%` placeholder. The bundle's `Configuration` declares scalar nodes, never enum or typed nodes that would reject a placeholder, and `load()` passes the values unchanged as arguments of the generated settings service. `load()` first refuses a literal value outside its values with an `InvalidConfigurationException` naming the key and the accepted values, so a typo such as `responses: stric` fails the container build; it tells an `%env()%` value by resolving its placeholder, and leaves it to the settings service. That service checks every value when the boundary first reads it, on each kernel boot: an invalid value answers the api's 500 on every contract route and logs the key and the accepted values, never the value. A value changed in the environment applies without a cache clear (spike).

The bundle registers its services under `seampact.<api id>.<role>` ids (`route_loader`, `input_resolver`, `settings`, `hooks`, `boundary`, `hook_check_warmer`, `route_check`), named by constants of the bundle class, never under class names, and the classes it registers carry `#[Exclude]`. The skeleton's `services.yaml` loads every class of `src/`, the generated tree included: a class-named definition it writes, autowired or excluded, would replace the bundle's when the container merges the extension configuration, and `#[Exclude]` keeps it from autowiring a class whose arguments are the bundle's. The app needs no `exclude` line.

Hooks are tagged services: authenticate hooks, deciders, scope resolvers and the idempotency store implement the `seampact/hooks` interfaces, narrowed by the generated request classes, and the extension tags them through autoconfiguration (`seampact.tasks.authenticate` and the like). `onUnexpectedError` is an optional service of the api's generated `Symfony\UnexpectedErrorListener` interface, so two apis never receive each other's failures. A decider names the rights and rules it serves; two claiming one name fail the boot check, no default hook exists, and a missing hook answers 500 (ADR 0012 "Registration and per-right overrides"). The request context, the resolved scopes included, is a request attribute under a generated name (ADR 0012 "Open tenancy").

Two apis are two bundles, each with its own subscriber, resolver, loader, configuration and boot check.

### The boot check

Before any other check, the contract class's `GENERATED_BY`, the full version of the generator that wrote it, is compared with the installed runtime's `RuntimeVersion::VERSION` (ADR 0025 "Version guards", G3): another `major.minor` or a lower patch refuses the boot as `runtime.generated-for-other-version`, with the fix to regenerate or install the runtime at the generator's version.

The boot check has two parts, each of which keeps a failing app from serving.

**The container part**, a compiler pass of the api's bundle at `TYPE_BEFORE_REMOVING`, after the event listeners are registered. It runs whenever the container is built: `cache:clear`, `cache:warmup`, and a request in debug mode after a configuration change. A failing pass writes no container (spike). It checks:

- the hook problems of ADR 0016's list, read from the tagged services;
- each generated interface implemented by exactly one service, every method of that service carrying the attribute with its operation id;
- the boundary's listeners at their priorities and the value resolver registered; no listener on `kernel.request` above 512 other than Symfony's `DebugHandlersListener`, and none on `kernel.response` below -2048, read from the listeners registered on the `event_dispatcher` definition;
- ext-zlib loaded, and a Symfony major of 7.4 or 8.x, read from `Kernel::VERSION`; `generate` already refuses older majors from the Composer lock;
- the `validator` service present, which step 6 runs every input through: without `symfony/validator`, or with `framework.validation` off, the check names the package to install rather than leaving Symfony's error on a missing service;
- no `#[IsGranted]`, `#[IsCsrfTokenValid]` or `#[IsSignatureValid]` on a contract method or on the class of its controller service, read by reflection: the first two would refuse a request after steps 6 to 8 ("Exceptions on contract routes"), and a signed URI is not a form the contract declares. The refusal names the method and the attribute, with the fix: an `access_control` rule on the per-kind request matchers ("Native security layers") or a decider for `#[IsGranted]`, the authenticate hook with the CSRF companion value for `#[IsCsrfTokenValid]`;
- `framework.http_cache` off: Symfony's HttpCache wraps the kernel, so a reply it serves from its store is never seen by the boundary. An `HttpCache` wrapped by hand in the front controller is not seen ("The outgoing response check").

Under absolute URLs, the pass also requires a `public_origin` key (its value is checked at run time); under relative URLs it refuses any value, an `%env()%` one included, as Laravel does.

**The route part**, a decorator of the `routing.loader` service. The router calls it with its root resource whenever it builds the route collection: in `cache:warmup`, on the first request after the router cache is cleared, and in debug mode when a routing file changes. It sees the whole collection once per build (spike). A failing check throws, so no router cache is written and every request answers 500 until the check passes (spike, prod). It checks:

- a contract operation without a contract route, or with two (the import repeated);
- an app route registered before a contract route with the same method and path, which the router would match first; other overlaps are left to the run-time 404 of "Routes";
- a route that the loader did not make and that `frameworkRoutes` does not allow-list (FR-25). The check skips Symfony's own routes, each matched by its name together with its controller, never by path:
  - `_preview_error`, the error preview of the `dev` environment, by its controller `error_controller::preview` (spike);
  - `_logout_<firewall>`, which SecurityBundle registers for a firewall's `logout.path`, by its name and its missing controller (spike);
  - the WebProfilerBundle routes `_wdt*` and `_profiler*`, by their names and their `web_profiler.controller.*` controllers (read from the bundle, not run);
- a route that the loader did not make whose controller is a contract interface's method or a method of the service implementing one, whatever `frameworkRoutes` allow-lists and whether that check is on; at run time the listener refuses such a request anyway (spike);
- a contract route whose path differs from `mount` followed by the contract path, `mount` being the one the generator receives through the target entry, or that carries a host, a scheme or a condition the loader did not set.

`artefacts.bootCheck: { handlers, frameworkRoutes }` switches those two checks apart (ADR 0011). Once both parts pass, neither runs per request, so a php-fpm serve pays nothing for them. While the route part fails, no router cache exists, so the loader and the check run again on every request until it passes. Production apps run `cache:warmup` at deploy or container start.

### Native security layers

Symfony's firewall, `access_control` and voters stay the app's. The target exports each operation's access in Symfony's native form (ADR 0012 "Native security layers"):

- the route names `seampact.<api>.<operationId>`;
- one request matcher service per access kind (`seampact.tasks.matcher.public`, `optional`, `identity`, `signed`), implementing `RequestMatcherInterface` with step 1's raw-path match, so a public template `/v1/things/{id}` never covers its identity sibling `/v1/things/mine`. The app uses them in `access_control` (`request_matcher:`) and in a firewall's `request_matcher`; step 1 runs before the firewall, so the match is there;
- a generated `TasksAccess` table, keyed by route name, giving each operation's access kind, identity, requirements and scopes.

Their refusals are mapped to roles as "Exceptions on contract routes" says. Symfony has no global CSRF check on JSON routes. A contract route's CSRF check is the authenticate hook's, with the CSRF companion value, and an `InvalidCsrfTokenException` that an app's authenticator throws answers `csrfInvalid`; `#[IsCsrfTokenValid]` and `#[IsGranted]` on a contract method are refused by the boot check.

Symfony answers the hooks as application code, with no adapter package in 1.0 (ADR 0012 "Optional adapters"):

- an authenticate hook reads the user from the token storage (`Security::getUser()`); the `kernel.controller` listener runs after the firewall, so the user is set (spike);
- a decider calls `isGranted` with the right name and a subject object carrying params and scopes, which the app's voters decide; the `AccessDeniedException` of `denyAccessUnlessGranted()` answers the first declared denial code;
- on an optional-auth route with `onRefused: anonymous`, the app's firewall is `lazy` with no `access_control` rule on the `optional` matcher, and the hook answers anonymous when the token storage has no user.

### Native access instead of hooks

With `artefacts: { accessHooks: false }` and `access: { native }` (ADR 0012 "Native access instead of hooks"), refused by name until a consumer needs it ("Refused by name or waiting"):

- the target generates no hook interfaces and no steps 2 to 5; the `kernel.controller` listener keeps its fail-closed checks and steps 6 to 8;
- it exports the `TasksAccess` table and the per-kind request matchers above, for the app's `access_control` and voters (`#[IsGranted]` on a contract method stays refused by the boot check);
- an operation that needs a principal at the boundary is refused by `generate`, as ADR 0012 says.

### What the shape-imposing features turn off with

The target imposes no wire shape ([A36](../decisions.md#a36)). Each feature that adds behaviour beyond the contract has a switch:

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| Symfony's own value constraints | native | `rules: seampact-consistent` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ handlers, frameworkRoutes }` |

The error format is the api's declared format. Symfony ships no OpenAPI generator of its own, and NelmioApiDocBundle annotations wait for a consumer that needs them ([A47](../decisions.md#a47)), so the target declares no `nativeDocs` artefact and reads no `frameworkDocs`: the app config refuses both keys by name (`config.artefacts.unknown`), as for Laravel.

### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own types and constraints in PHP. A link on its entry is refused by the runner with `link.kind.not-consumed`, naming the entry and the link, before any generator runs: no link reaches the generator. It generates no client.

### What the generated code depends on

At run time:

- PHP `>=8.3.36 <8.4 || >=8.4.27 <8.5 || >=8.5.12`, the releases carrying the October 2026 fixes (CVE-2026-109618 and CVE-2026-109619), so Composer refuses an unpatched runtime; ext-json, ext-mbstring and ext-zlib;
- `symfony/framework-bundle`, `symfony/http-kernel`, `symfony/routing`, `symfony/validator` and `symfony/var-dumper`, 7.4 or 8.x, the versions the app already has;
- `seampact/hooks`, and `seampact/symfony` with `seampact/codegen`, whose runtime the code imports.

The boundary runtime is imported, not copied (ADR 0025): `Seampact\Symfony\Runtime`, which `seampact/symfony` autoloads from `runtime/`, and the shared `Seampact\Codegen\Runtime`. Generated code imports no other seampact package than these and `seampact/hooks`, no Serializer, and no package beyond Symfony's own components (SecurityBundle, RateLimiter and NelmioCors stay the app's). `seampact/symfony` is a production `require`; its `seampact:generate` command comes with its own bundle, which the app still lists in `config/bundles.php` for the `dev` environment only, since production never generates. Generated files print through `nette/php-generator`'s `PsrPrinter` (ADR 0015) and pass `php -l` and PHPStan at level max on PHP 8.3 with Symfony 7.4 and on PHP 8.5 with Symfony 7.4 and 8.x.

### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the target does not serve yet ([A47](../decisions.md#a47)): `input.multipart.unsupported`, `input.form.unsupported`, `type.file.unsupported`, `response.shape.unsupported` and `artefacts.accessHooks.unsupported`, each saying it waits for an app that needs it. It reads only the operations the target entry's `operations` filter keeps (ADR 0011): a form that no kept operation carries is neither generated nor refused.

| Waits for | What |
|---|---|
| a consumer that needs them | form bodies (ADR 0012 bodies table), refused by name as on every Node target; multipart (when it comes: `UploadedFile` with the `File` constraint; PHP stores an upload before any PHP code runs, so the boundary refuses a `Content-Length` above the route limit and `post_max_size` bounds the rest), download (`BinaryFileResponse`, `StreamedResponse`) and redirect (`RedirectResponse`) bodies and native access (`artefacts.accessHooks: false`), which the Spring and Laravel targets refuse the same way and the reference contract does not carry; string formats other than `uuid` and `date-time`; NelmioApiDocBundle `nativeDocs`; unions (`oneOf`) until a contract needs one |
| after 1.0 | Symfony 7.3 and older (refused, not waiting); worker runtimes (refused, below); `framework.http_cache` (refused by the boot check); `hooks: vendored` ([A40](../decisions.md#a40)); API Platform, its own target; every IR form absent from the reference contract's golden IRs, as the Spring and Laravel targets refuse them: `list` responses, response headers the route writes itself, principal requirements, bindings, upstream calls, operation features, extension keys, input field rights below the top level, scope ids not read from the path, bucket keys not read from the path, a scope or the principal, rule proofs outside the body, principals of several variants, signatures verified by the application or keyed from the request, parameter and property defaults, open enums, maps, `int64` and `decimal`, kept unknown keys, recursive input schemas, integer steps beyond the PHP `int` range |

A worker runtime is refused, since serving many requests from one container is unproven in 1.0 ([A47](../decisions.md#a47)): services keep per-request state, and resetting the boundary's services through `kernel.reset` is not tested. Two guards apply, both outside the boot check:

- The bundle's `boot()`, which runs on every kernel boot, reads `kernel.runtime_mode.worker` and throws `runtime.worker.unsupported` with the fix "serve the app with php-fpm, or keep this api's bundle out of the worker app". FrankenPHP's worker runner sets `APP_RUNTIME_MODE` to `web=1&worker=1`, so a worker's kernel never finishes booting and serves no request (spike, with that value set by hand; FrankenPHP not run).
- A runner that does not set that value (RoadRunner, Swoole, ReactPHP) is caught by the `kernel.request` listener, which counts the main requests its container instance has seen: from the second one, it answers the api's 500 on every contract route and logs `runtime.worker.unsupported`, failing closed. Under php-fpm each request builds a new container instance, and `KernelBrowser` reboots the kernel between requests by default; a functional test that calls `disableReboot()` meets the guard, and the Symfony guide says so.

The Symfony guide names php-fpm as the supported server.

### The consumer and the proof

The sample app lives in `scripts/consumers/targets/symfony/`. It is a Symfony skeleton with SecurityBundle, Validator and RateLimiter, which holds the developer's controllers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a Monolog handler. It reads the template's credentials from the shared JSON. It installs `seampact/hooks`, `seampact/symfony` and `seampact/ir` from Composer path repositories pointing at the split trees (ADR 0011 "Unpublished installs for test consumers"), and the reference contract's bundle that the workflow built.

The workflow `p6-symfony.yml` has five jobs:

- `changes`;
- `contract-bundle` (Node), which bundles the reference contract (ADR 0011 "The bundle");
- `build`, a matrix of Symfony 7.4 on the latest PHP 8.3 and 8.5 and Symfony 8.x on the latest PHP 8.5, in glibc `php` images, whose first step fails when `node`, `npm` or `npx` is found. It installs the app with Composer only, generates from that bundle, and runs `cache:warmup --env=prod` as the boot step; the local-YAML rows, through the compiler binary, come with php-core-4;
- `http-suite`, which serves the app with php-fpm behind nginx, as production does, and runs the `default`, `hand-written` and `boot` profiles through the suite's CLI (ADR 0015 "Suite profiles");
- `symfony`, the aggregate, failing on any failed or cancelled job.

The proof is:

- the `node`-absent step;
- a green suite row per matrix entry;
- `php/symfony/tests/RedactionTest.php`, on the golden classes (one class of each kind of "Redaction" holding a known secret, which `var_dump`, `print_r` and VarDumper must not show while `[redacted]` is present);
- the suite's security rows: symfony-2 added a bad-credentials `http_basic` row answering `unauthenticated` through `LoginFailureEvent` and an `access_control` row answering `forbidden`; symfony-3 added a `login_throttling` row answering `rateLimited`; symfony-4 added an `access_control` row on a per-kind matcher;
- the suite's media rows.

The suite's refusal list is empty: the reference contract carries no form that waits.

### Delivery

| PR | Delivers |
|---|---|
| symfony-1 | `php/symfony` (`Seampact\Symfony`), on the shared emitters and form walk of `php/codegen` (`Seampact\Codegen`), where each PHP target names the release that brings a refused form: the generator class registered in `extra.seampact.generator`, the options, readonly classes with `Field`, controller interfaces, the `#[SeampactOperation]` attribute, the route loader, the input value resolver, the generated constraints with their validators under both `rules` modes, the exceptions per error, the api's bundle and its extension; a golden for the reference contract, linted with `php -l` and PHPStan max on PHP 8.3 with Symfony 7.4 and PHP 8.5 with Symfony 7.4 and 8.x |
| symfony-2 | the boundary subscriber (step 1, steps 2 to 8 in the `kernel.controller` listener with its fail-closed checks, the `kernel.view` reply, the exception listeners, the `LoginFailureEvent` record and the mapping, step 10, on the main request only), tagged-service hooks, the rights and rules an operation requires with rule proof fields in the body, scopes in request attributes, the 500 on a missing hook, the boot check's compiler pass, with the attribute refusal, and its routing-loader decorator, the worker refusal and the second-main-request guard, `bin/console seampact:generate`; the sample app with path repositories under php-fpm behind nginx, SecurityBundle with `http_basic` and one `access_control` path, the core suite profile with the bad-credentials 401 row and the `access_control` 403 row, the e2e job of `p6-symfony.yml` |
| symfony-3 | paging with its `sort` parameter, idempotency, throttle through a RateLimiter factory, cache headers and the response headers of these features, retry headers, the signed raw body, deadline budgets and relayed operations, opaque values, redaction (`__debugInfo()`, `#[\SensitiveParameter]`, the VarDumper caster); the full suite profile with the `login_throttling` 429 row, and `RedactionTest.php` |
| symfony-4 | the user from the token storage after the firewall, `isGranted` with a subject carrying params and scopes, `AccessDeniedException` answering the first denial code, the per-kind request matchers and the `TasksAccess` table, the mapping of an `HttpException` 401, 403 or 429, the bundle configuration with `%env()%` values checked at run time, absolute URLs with the boot check's `public_origin` rule; the suite's `access_control` row on a per-kind matcher and the native layers on identity routes in the sample app. Multipart, downloads, redirects and native access wait for a consumer ("Refused by name or waiting") |
| symfony-dx-1 | request bodies read through the request (`KernelBrowser` tests), one rule mapping framework exceptions, route placeholders named after the input properties and pinned to one segment, the bundle's services kept under the skeleton's `services.yaml` import with no `exclude` line, services registered as `seampact.<api>.<role>`, a mistyped `seampact_<api>` value or a missing `symfony/validator` refused at `cache:clear` |
| symfony-routes | `<Api>RouteNames` constants and typed `<Api>Urls` path builders, off with `artefacts: { routeHelpers: false }` |

### Amendment 2026-10-26: what symfony-2 built

- **The hook part of the boot check** runs in a non-optional cache warmer of the api's bundle, not in the compiler pass, since a pass cannot ask the hooks their names without building services. `cache:clear` and `cache:warmup` fail with "the api 'tasks' cannot start" and every hook problem; a request that builds the container runs the warmer too and fails with a bare 500, while the container it wrote stays. That 500's body is the app's error display (empty in production, PHP's or Symfony's error page with the message in debug), so nothing of the contract shows there. The boundary asks the same on the first contract request of each container instance and answers the api's 500 with a log line, so under php-fpm and PHP's built-in server the hook part runs on every request. On the consumer (PHP 8.5, Symfony 7.4, built-in server) the whole boot check adds under 10 ms to a cold `cache:warmup` of about 220 ms, and no measurable time to a contract request (10 to 13 ms with or without it, over 300 requests).
- **Exceptions on contract routes**: the generated exceptions and the boundary's own failures are still answered at priority 128. An exception no role maps is answered by a second `kernel.exception` listener at priority -64, after the app's listeners at the default priority and before `ErrorListener` (-128): the app's listeners see every exception, a reply one of them sets is judged by the outgoing check as written, and otherwise the reply is the api's 500, never Symfony's error page. A native refusal is left to the firewall and `ErrorListener` and mapped at `kernel.response`; it is read from the recorded first exception, since the firewall's listener replaces an `AccessDeniedException` with an `AccessDeniedHttpException`. An `AccessDeniedException` from the authenticate hook goes to the firewall's entry point and answers `unauthenticated`. Once the authenticate hook has admitted the caller, whom the firewall still sees as anonymous, an `AccessDeniedException` from a scope resolver or a decider answers `forbidden`, as on Laravel. The router's 404 or 405 for a path step 1 matched raw (`a%2Fb`) is left to `ErrorListener` and answers `notFound` on the way out.
- **The boundary's own replies** (its refusals, the catch-all 404, the api's 500) are checked again at `kernel.response`: an app listener that changes their status, media type or body gets the api's 500; headers it adds stay.
- **Redaction**: the VarDumper caster came with symfony-2. The bundle's `boot()` registers it for each identity's generated credentials class and the hook calls that hold credentials; it dumps the object's `__debugInfo()`. The rest of "Redaction" came with symfony-3.
- **The consumer** is served by PHP's built-in server, as the Laravel one is (ADR 0023), not by php-fpm behind nginx. `p6-symfony.yml` gains a `contract-bundle` job and one `e2e` job, gated by `changes` and needed by `symfony`, with the PR rows Symfony 7.4 on PHP 8.3 and Symfony 8 on PHP 8.5. The app is a `MicroKernelTrait` kernel without Flex, Monolog or RateLimiter: its `logger` service feeds the `log-lines` route, its `access_control` rule uses a request matcher keyed on a suite header, and a boot case runs `cache:warmup` into a cache directory of its own. The core operations declare no 403, so the `access_control` row answers the api's 500 and logs the `forbidden` role it kept. The spike's "CLI server" results stay proven on that server only.

### Amendment 2026-10-26: what the shared PHP code gives Symfony from laravel-3b

- The edits laravel-3b made to `php/codegen` serve Symfony too: success envelopes rendered around the payload (a bare format still answers a `null` payload as `null`), enum principal members written as their wire values, and the refusals by name of `format.meta`, `format.success.headers` on a shape a response takes, `format.success.slot`, `format.success.envelope` (an envelope that does not write `$payload` under named members) and `degradable`, each after 1.0.

### Amendment 2026-10-26: what symfony-3 built

- **Idempotency** runs in the `kernel.controller` listener after step 8: a replayed reply takes the controller's place, so the handler never runs. The reply is settled at `kernel.response` once step 10 has checked it; a failure of that check releases the key, and so does any 5xx reply, the boundary's own 500 for an exception no role maps included, as on Laravel and Spring. The store is the service `Seampact\Hooks\IdempotencyStore`, an alias the app sets; the boot check refuses an api with boundary-enforced idempotency and no store, or a store of the wrong type, on both PHP targets.
- **Cache-Control**: Symfony's `ResponseHeaderBag` writes `Cache-Control` in its own order (`max-age=60, private`) and adds `no-cache, private` where the contract writes none, as on Laravel; the directives are the same as on the other targets.
- **Throttle**: the consumer's decider counts the throttled user's bucket in a `framework.rate_limiter` factory keyed by the bucket key. The `login_throttling` row answers the api's 500 and logs the `rateLimited` role it kept, since no reference operation declares that role (as the `access_control` row does for `forbidden`).
- **Rule proofs in the body**: the body's top level also takes the proof fields of its rules, which the access steps check, so `unknownKeys` does not refuse them (`purgeTask`'s `reauthToken`).
- **Header issues** point at the header's name in lower case, as on the other targets.
- **Opaque values** accept `null` only when nullable (ADR 0003 section 2) and refuse a non-finite number anywhere inside them as `type`, as on the Laravel target.
- **Route names** are `seampact.<api id>.<operationId>`, as the boundary reads them; the routing resource and the bundle configuration keep the snake-case api key (`tasks_service`, `seampact_tasks_service`), and the route check's fix names that resource.
- **Redaction** needed no Symfony code beyond the shared runtime: the bundle's `boot()` registers the VarDumper caster for every generated value class and runtime holder.
- **Absolute URLs** came with symfony-4, where `public_origin` lives in the bundle configuration and the boot check requires it; the reference contract writes relative URLs.
- The consumer serves both apis of the reference contract, with the `tasksService` bundle beside the `tasks` one.

### Amendment 2026-10-27: what symfony-4 built

- **The per-kind request matchers** are four services per api, `seampact.<api id>.matcher.<kind>` (`public`, `optional`, `identity`, `signed`), each a `KindRequestMatcher` of the copied runtime. A matcher runs step 1's raw-path match itself rather than reading step 1's request attribute, so it answers the same in a firewall's `request_matcher`, in `access_control` and in an app listener; a path no operation serves matches no kind. An identity verified by a signature is the `signed` kind, as on Laravel, read through the shared `AccessKind` of `php/codegen`.
- **The `TasksAccess` table** is a constant `ROUTES`, keyed by route name, whose rows give the operation id, the kind, the identity (null on a public route), the rights and the rules it requires, by name, and the scopes it resolves; `KINDS` lists the four kinds.
- **An `HttpException` 401, 403 or 429** from a handler or an app listener on a contract route is left to Symfony's `ErrorListener`, as the other native refusals are, and mapped at `kernel.response` to `unauthenticated`, `forbidden` or `rateLimited`. Off a contract route the boundary holds no state, so nothing is mapped.
- **Absolute URLs**: the bundle configuration takes a scalar `public_origin`, passed to the settings service whatever the api writes, so the boot check sees it. The settings check it on each contract request, when step 1 builds the boundary state, with the shared `PublicOrigin` rules (Spring's `URI` parity); an invalid value answers the api's 500 and logs the key and the accepted form, never the value. The boot check's compiler pass refuses an api that writes absolute URLs and sets no `public_origin`, and a literal one that is not an origin, as Laravel and Spring refuse at start; an `%env()%` value passes, since its value is only known at run time. The pass resolves the `env_<hash>` placeholders the configuration merge writes back to `%env()%` before it checks. Under relative URLs it refuses any value, an `%env()%` one included, and the settings refuse one at run time too.
- **The consumer** reads the firewall's user from the token storage in its authenticate hook (`Security::getUser()` on an `http_basic` login), asks its voter through `isGranted` in its decider with a subject carrying params and scopes, has an `access_control` rule on the generated identity matcher chained with a suite header, and an app listener on the same matcher that throws an `HttpException` of the status a suite header names. The Symfony edges check each of them on Symfony 7.4 and 8.

## Spike

Run on Symfony 7.4.21 and 8.1.9 (fresh `symfony/skeleton` apps with SecurityBundle, Validator, Serializer and RateLimiter) on PHP 8.5.4 under the PHP CLI server, and not kept. Both majors gave the same result on every case. PHP 8.3, php-fpm, FrankenPHP, WebProfilerBundle and NelmioCorsBundle were not run. The results marked "CLI server" (the chunked bounded read) depend on the server; symfony-2's php-fpm suite proves them. A reduced boundary had:

- one event subscriber with the listeners and priorities of "Placement", a raw-path matcher, a bounded body read with gzip decoding, the authored-reply record and the exception mapping;
- a value resolver at priority 150, a route loader tagged `routing.loader` whose routes name the interface, and a controller service implementing it with the attribute on each method;
- step 6 with generated type checks on the objects-preserved tree and Symfony constraints carrying the contract rule in their `payload`;
- SecurityBundle with `http_basic`, `access_control` on two contract paths, an app route to a contract action, an app route under the base path, and an app `kernel.exception` listener at priority 0.

Requests were sent with curl.

| Case | Result |
|---|---|
| listener order on `GET /v1/tasks/7` and on `access_control`'s path with a user | step 1, `RouterListener`, the routed marker, the firewall, the `kernel.controller` listener with the user in the token storage, the value resolver, `kernel.view` |
| a route naming the interface, before and after tagging the implementing service `controller.service_arguments` and aliasing the interface publicly | refused as a private service; resolved to the controller |
| `/v1/tasks/%73earch`; `POST /v1/tasks:batch`; `GET /v1/tasks/search` | `getPathInfo()` kept `%73earch`, the router chose search, 404 from the listener; the batch route; the search route, registered before `{p1}` |
| `/v1/tasks/7/`, `/v1//tasks/7`, `x/../7` and `%2e%2e/7` (sent as is), `7;x=1`, `DELETE` on a `GET` path, an app route `/v1/tasks/{x}/extra` | 404 from step 1 before routing |
| `a%2Fb`; `%E0%A4%A` | router not found, 404 on the way back; 400 from step 1 |
| `HEAD` | the `GET` operation, body dropped by `prepare()` before the check, which compared the body and flagged it until it compared the status only |
| `X-Forwarded-Prefix: /api` from a trusted proxy | `getPathInfo()` unchanged |
| `Content-Length` over the limit; chunked over the limit; a gzip body; `text/plain`; `{` | 413 before reading; 413 while reading; decoded; 415; 400 |
| a signed route body `{"note":"  x  ","e":""}` read by step 1 through `getContent(true)` | the app's `getContent()` returned the same bytes |
| `{"title":5,"priority":"3","note":7}`; `[]` as the body; `priority: 1.0`, `note: null` on a nullable member | three type issues; one type issue; passed |
| a handler returning `JsonResponse`; a `RuntimeException`; the same with `Accept: application/json` | not authored, replaced by 500; HTML from `ErrorListener`, seen by the check; problem+json from the Serializer's renderer, seen by the check |
| a generated 409 exception, without and with the app's catch-all listener at 0; a `RuntimeException` with the catch-all | 409 from the boundary both times; the app's 418, seen by the check |
| anonymous on an `access_control` `ROLE_USER` path; `ROLE_USER` on a `ROLE_ADMIN` path | `AccessDeniedException` recorded, the entry point's 401, mapped to `unauthenticated`; recorded, 403, mapped to `forbidden` |
| an app route `PUT /app/update/{id}` to the controller's `updateTask` | the listener saw the attribute without a contract route, the internal exception, 500 |
| `Regex`, `Email`, `Url`, `Uuid`, `Ip` on `""`; `Length(min: 1)` on `""`; `Length(min: 5)` on `"   "` | passed unchecked; refused; refused |
| `Length(max: 3)` on three emoji; `Length(max: 1)` on a flag; `Regex('/^.$/')` without `u` on an emoji | passed; refused (two code points); refused |
| `Range(max: PHP_INT_MAX)` on `"9223372036854775808"`; `Range(10, 20)` on `"15"`; `Range(1, 5)` on `1.0` | passed (compared as floats); passed (a numeric string); passed |
| `Unique` on `[1, 1.0]`; `Choice([1, 2])` on `"1"`; `DivisibleBy(0.1)` on `0.3`; `DivisibleBy(0.01)` on `19.99`; `GreaterThan(0)` on `null` | passed; refused; passed; passed; passed |
| a compiler pass that throws, in `cache:clear --env=prod` | no container written |
| a routing-loader decorator that throws, in `cache:warmup --env=prod` from an empty cache, then prod requests | no router cache written; 500 on a contract route and on an app route; 200 once the check passed, with no cache command |
| `SEAMPACT_TASKS_RESPONSES=warn` in a prod server's environment, after the cache was built without it | the service argument read `warn`; `strict` on a server without it |
| `APP_RUNTIME_MODE=web=1&worker=1`, then `web=1`, on a prod kernel boot | `kernel.runtime_mode.worker` true and the bundle's `boot()` refusal thrown; false and the kernel booted |
| `debug:router` with a firewall `logout.path` in `dev` | `_preview_error` (`error_controller::preview`), `_logout_main` (no controller) |

Read from the sources, not run: the firewall adds its `ExceptionListener` at `kernel.exception` priority 1 and turns an `AccessDeniedException` on an anonymous token into the entry point's reply, or a 401 `HttpException` without one; `#[IsCsrfTokenValid]` throws `InvalidCsrfTokenException`, which extends `AuthenticationException`; `#[MapRequestPayload]` answers a failed validation with 422 by default; FrankenPHP's worker runner sets `APP_RUNTIME_MODE` to `web=1&worker=1`, or `web=1&worker=2` when it resets the kernel; `RequestAttributeValueResolver` has priority 100 (Symfony docs). Read from the 7.4 sources in the review of this ADR: `AuthenticatorManager` answers an authenticator's failure with `onAuthenticationFailure()` after dispatching `LoginFailureEvent`, without reaching `kernel.exception`; `TooManyLoginAttemptsAuthenticationException` extends `AuthenticationException`; `ensureAccepted()` throws `RateLimitExceededException`, a `RuntimeException`; `IsGrantedAttributeListener` and `IsCsrfTokenValidAttributeListener` listen at `kernel.controller_arguments` (priorities 20 and 25). Probed with `php -r` on PHP 8.5.4: `JSON_BIGINT_AS_STRING` decodes `123456789012345678901234` and `"123456789012345678901234"` to the same string; `9223372036854775808.0 > PHP_INT_MAX` is false; `{"\u0000a":1}` does not decode with objects preserved.

## Consequences

- An app keeps its controllers, its listeners, its error controller, its firewall, `access_control` and voters. On contract routes the boundary's checks and reply win, and its own routes are unchanged.
- The check order holds in Symfony without app setup beyond listing the bundle and importing the routes: the router, the Serializer, `#[MapRequestPayload]` and the entity value resolvers never decide a contract input.
- Every reply on a contract route is checked, from whichever writer, exceptions and streams included, except the writers that bypass the response and an exception thrown inside `Response::send()`.
- A firewall refusal that the operation declares answers in the api's format.
- A path value whose percent-decoding is not UTF-8 is refused before steps 2 to 5 run, and `%2F` in a segment answers the path's 404, as on Laravel; the Node targets pass both to step 6.
- A `br` error body is a violation here, where ADR 0016 decodes it.
- A body with an object key that starts with a NUL byte is the malformed 400 here, since PHP cannot hold that key as a property name; the Node and JVM targets accept it.
- A multipart body cannot be counted as it arrives: PHP stores the upload before the app runs. The boundary refuses a declared `Content-Length` above the route limit, and `post_max_size` and the web server's limit bound the rest, the PHP exception that ADR 0012's obligations state.
- Under `rules: native`, Symfony's constraints give their own verdicts, listed in the Symfony guide; an empty string never escapes a pattern or a format.
- A failing boot check stops the app from serving at all, app routes included, until the check passes. Once it passes it costs nothing per request; while its route part fails, the loader and the check run on every request.
- `dump()`, `dd()` and the profiler hide sensitive values through the bundle's caster; `var_export`, `json_encode` and `(array)` do not.
- Symfony 7.3 and older, worker runtimes and Symfony's HttpCache cannot be used with the target in 1.0; a FrankenPHP worker that loads a seampact bundle never finishes booting, and another long-running runner answers 500 on contract routes from its second request.
- `#[IsGranted]`, `#[IsCsrfTokenValid]` and `#[IsSignatureValid]` cannot be used on a contract method; access goes through `access_control`, voters called by a decider, or the hooks.
- ADR 0012's symfony row is amended to match: step 1 runs in a `kernel.request` listener placed before routing and the firewall, step 10 in a `kernel.response` listener placed last, the generated exceptions in a `kernel.exception` listener, and framework refusals, an authenticator's failure through `LoginFailureEvent` included, are mapped on the way back; `#[IsGranted]` and `#[IsCsrfTokenValid]`, which run after argument resolution, are refused on contract methods.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, controllers stay the developer's), FR-21 (PHP targets), FR-25 (framework routes and the boot check), FR-35 (the shared suite); CHK-084, CHK-158, CHK-168, CHK-174; amendments A9, A15, A25, A30, A36, A40, A41, A42, A47.
- ADRs: 0003 (the PHP decoding and rule mapping), 0007 (PHP names), 0009 (artefacts, `rules`, matrix), 0010 (artifacts, namespaces), 0011 (app config, unpublished installs), 0012 (placement and obligations), 0013 (raw body), 0015 (runtime copies, golden tests, suite profiles), 0016 and 0023 (the shared obligations and the PHP target this one mirrors).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the Symfony consumer.

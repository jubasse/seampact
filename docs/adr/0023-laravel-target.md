# ADR 0023: The Laravel server target

Status: accepted

## Context

ADR 0012 fixes what every server target generates around the developer's controller, places the laravel steps in its target table and lists the laravel obligations. ADR 0016 fixes the rules this target meets in PHP: the check order, a reply written by the boundary, exceptions handled narrowly, the outgoing response check and its `responses` modes, the body limit, query decoding and the bounded values. `seampact/laravel` (ADR 0010 "Native artifacts") generates, per api of the app config, PHP that places those checks around the developer's controllers in a Laravel application. `vendor/bin/seampact generate` and `php artisan seampact:generate` run it, and the app builds on a machine without Node ([A9](../decisions.md#a9)). This ADR states where each step runs in Laravel, how each obligation is met, what the developer can turn off, and what waits. What it does not restate holds as ADR 0016 says.

Six Laravel behaviours shape the placement:

- Global middleware runs before routing. Route middleware runs after it, in the order of the kernel's priority list for the middleware the list names, and in declared order for the others.
- `Illuminate\Routing\Pipeline` catches an exception at every stage, renders it through the app's exception handler, and sets the original exception on the reply (`$response->exception`). An outer middleware therefore receives a reply, never an exception.
- A FormRequest is resolved when the controller method is called, after every route middleware. It runs `authorize()`, `validationData()`, the rules, then `failedValidation()` or `passedValidation()`.
- Laravel's request input is `json_decode($body, true)`, which gives `{}` and `[]` the same empty array. The validator skips its non-implicit rules on an empty or whitespace-only string, and reads `.` and `*` in a data key as path separators.
- Native security layers (`PreventRequestForgery` in the `web` group, `ThrottleRequests`, `Authenticate`, `Authorize`) refuse by throwing, before the controller.
- An app boots per request (php-fpm) or once per worker (Octane), and may cache its routes and config (`route:cache`, `config:cache`). A streamed reply's callback runs in `Response::send()`, after every middleware has returned.

## Options

- Laravel majors: 13 only, or 12 as well. Choice: 13 only. Laravel 12's bug fixes ended on 2026-08-13, and a second major would double the middleware and exception paths. 12 and older are recorded as incompatible in the compatibility matrix, so `generate` refuses them by name (ADR 0009 "Artefacts and the compatibility matrix").
- Step 1 and the outgoing check: in a route middleware, or in a global middleware placed first. Choice: the global middleware. It sees the raw path before `ValidatePathEncoding`, `TrimStrings` and routing, and it receives every reply of the later global middleware, of the route middleware and of the handler, with the exception that produced it (spike).
- Steps 2 to 5: in the global middleware, in `FormRequest::authorize()`, or in a route middleware placed with the priority list before `SubstituteBindings`. Choice: the route middleware. It runs after the group's session, CSRF, throttle and guard middleware, so a hook can read a session guard, and before route-model binding (spike). `authorize()` runs only once the method is called, after every route middleware.
- Step 6: Laravel rules alone, every check generated, or generated structural rules with Laravel's value rules. Choice: the FormRequest of ADR 0012, whose rules hold generated rule objects for the structure and, under `rules: native`, Laravel's own value rules ("Types and validation" below). Laravel rules alone cannot tell `{}` from `[]`, since the request input decodes both to an empty array, and `integer:strict` refuses a whole-number float such as `1.0` that the contract accepts as an integer (spike).
- Reply path: a middleware that rewrites the handler's reply, or generated results implementing `Responsable`. Choice: `Responsable`; the router turns the handler's return value into the reply through it, written by the boundary's own encoder.
- Framework refusals: render callbacks registered on the app's exception handler, or a mapping of `$response->exception` in the global middleware. Choice: the mapping. The app's `withExceptions` callbacks are registered first and win, and `Authenticate` can fail while building its exception (spike).
- Routes: a generated routes file, or a `Route::seampact()` macro. Choice: both, as ADR 0012 says, with the macro as the default (option `routes`).

## Decisions

### Placement

The developer writes controllers implementing the api's generated interfaces (ADR 0007 `handlers`, `TasksEndpoints`) and binds each interface in the container. Each method takes the operation's generated FormRequest:

```php
final class TasksController implements TasksEndpoints
{
    public function updateTask(UpdateTaskRequest $request): UpdateTaskResult { ... }
}
```

Codegen emits, per api, under the target entry's `out`, in its PSR-4 namespace:

- **Per operation**:
  - the FormRequest (`UpdateTaskRequest`), which runs steps 6 to 8 and hands over the typed input with `contractInput()`;
  - the input class, the result classes and one exception class per code. The input holds the path, query and header parameters and the body; the credential and CSRF headers, which the boundary reads, are not in it.
- **The boundary middleware** (`TasksBoundary`), a global middleware prepended before every other one, `ValidatePathEncoding` and `TrustProxies` included (spike). It runs step 1:
  - the request context;
  - the raw-path match of "Routes" below;
  - the media type;
  - the bounded body read and the decoding;
  - the outgoing response check.
  It answers its own refusals in the api's format. On the first request of each booted application, which under php-fpm is every request, it checks that it is the first entry of the kernel's global middleware. When it is not, it answers the api's 500 and logs the fix on every request, so a route-cached serve, which skips the boot check, still keeps "boundary first".
- **The access middleware** (`TasksAccessMiddleware`), on every contract route and added to the priority list before `SubstituteBindings`. It runs steps 2 to 5: authenticate, principal requirements, scopes and requirements. It first checks that the route Laravel chose carries the operation that the raw path matched ("Routes"). Once steps 2 to 5 admit the request, it marks the request with that operation id, in a request attribute under a generated name.
- **The registration**: one service provider per api (`TasksSeampactServiceProvider`), which the app lists in `bootstrap/providers.php`. It:
  - prepends the boundary middleware and places the access middleware, through the HTTP kernel;
  - registers the routes macro, or loads nothing under `routes: file`;
  - merges and publishes the config of "Options and registration";
  - excludes contract routes from `TrimStrings` and `ConvertEmptyStringsToNull` (`skipWhen`);
  - runs the boot check;
  - refuses Octane at worker start ("Refused by name or waiting").

Both middleware are registered from the provider, with no edit to `bootstrap/app.php` (spike). The routes point at the interface (`[TasksEndpoints::class, 'updateTask']`), which the container resolves to the bound controller, cached routes included (spike). Each route is named `seampact.<api>.<operationId>`.

The generated types go into the PSR-4 namespace `composer.json` gives the entry's output directory, which the runner derives (ADR 0010 "Namespaces"), so no option names it; the schema types go into its `Schemas` sub-namespace. The Laravel placement goes into its `Laravel` sub-namespace, and the copied runtime into `Laravel\Runtime`. A declared schema `UpdateTask` and a placement class never share a namespace. Fixed class names that ADR 0007 has no role for are Pascal-case words prefixed by the api's type name, and constants are upper snake case (`MAX_CHECKED_ERROR_BODY_BYTES`).

The handler method returns the operation's generated result: an interface implemented by one final class per declared success status and by the typed error result (ADR 0007 `errors` role). It may instead throw one of the generated exceptions, declared with `@throws` on the interface method (ADR 0012 "Errors the handler answers"). A decide hook that throws Laravel's `AuthorizationException` (`Gate::authorize()`) answers the requirement's first declared denial code. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").

### Routes

Patterns use Laravel's syntax with positional parameter names (`/v1/tasks/{p1}`), which the boundary never reads. A `:` inside a static segment is literal (`/v1/tasks:batch`, spike). `generate` refuses by name:

- a static segment holding `{`, `}` or `?` (`path.segment.literal.unsupported`);
- a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`), as on Fastify, Hono and Spring.

Laravel matches routes in registration order, so the generated registration registers, per path depth, literal segments before placeholders: `/v1/tasks/search` before `/v1/tasks/{p1}`.

The boundary middleware matches the raw request target against the contract templates. The raw target is `REQUEST_URI` without the query, minus the front controller's base path, computed from the server variables and stripped as a raw prefix (spike, CLI server). It never uses forwarded headers: the boundary runs before `TrustProxies`, and under Octane the trusted proxies an earlier request set would add `X-Forwarded-Prefix` to `getBaseUrl()`. The access middleware then compares the operation of the route Laravel chose with that match. Laravel decodes the path before routing, so the two can differ:

- `/v1/tasks/%73earch` reaches the search route while the raw path matches `{p1}`. The access middleware answers the path's `notFound` 404 before any check (spike).
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the boundary, before routing, on every Node target's terms (ADR 0016 "Errors raised before routing"). This covers a trailing slash (which Laravel would trim and route), `//`, a dot segment (`x/../7`, `%2e%2e`), a percent-encoded static segment, and a segment holding a `;` path parameter (`7;x=1`), as on Spring (ADR 0022 "Routes"). The spike's reduced boundary answered the first three cases this way; it had no rule for `%2e%2e` and `;`, which Laravel routes to `{p1}` as values.
- `a%2Fb` in a segment matches `{p1}` raw, but Laravel routes the decoded `a/b` and finds no route, or the app's `Route::fallback()` answers it (200, no exception). On the way back, and only once routing ran (the router matched a route or raised its not-found exception), the boundary reads the route Laravel chose (`$request->route()`): a reply Laravel gives before routing (a bad encoding 400, a 413, a 503, a CORS preflight) keeps its own status. When the chosen route is not the contract route of the operation that the raw path matched (no route, an app route, the fallback or another contract route), the boundary answers that path's `notFound` 404, whatever the reply.
- A segment whose percent-decoding is not UTF-8 (`%E0%A4%A`) is refused by Laravel's `ValidatePathEncoding` with a `MalformedUrlException` (spike). The boundary answers it as ADR 0016 answers a path value that does not decode, the `schemaInvalid` 400 with that parameter's issue, without running steps 2 to 5.
- `catchAll: false` leaves those paths to the app. A base path shared with another api of the app is left to the app.

Other methods:

- `HEAD` runs the path's `GET` operation fully, and Symfony's `Response::prepare()` drops the body.
- A method the path does not serve answers the path's `notFound` 404 from the boundary, where Laravel would answer 405 with `Allow`, or 200 for `OPTIONS` (spike).
- A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's `HandleCors`, which runs after the boundary in the global stack.

`mount` is the route group prefix that the generated registration applies around the contract routes.

### The reply path

Every result class implements `Responsable` and every generated exception has a `render()` method; both write the contract reply themselves:

- a `Symfony\Component\HttpFoundation\Response` with its status, headers and body, serialized by the boundary's own `json_encode` call (`JSON_THROW_ON_ERROR`, `JSON_UNESCAPED_SLASHES`, `JSON_UNESCAPED_UNICODE`, `JSON_PRESERVE_ZERO_FRACTION`), never an API Resource, a `JsonResponse` default or the app's macros;
- one path for a 2xx among several, the derived 304 with the boundary's strong ETag, an idempotent replay and every contract error.

Content negotiation is not consulted. A client's `Accept` changes nothing that the contract does not say. The boundary marks each reply it writes, so the outgoing check can tell it from a reply the app wrote.

### Exceptions on contract routes

A generated exception answers through its own `render()`, which Laravel's handler calls before any render callback of the app, a catch-all included (spike). It implements `ShouldntReport`, so the app's reporting stays quiet. An app `$exceptions->map()` that replaces it is the app's choice; the outgoing check judges the result.

Every other exception is rendered by the app's own handler, untouched. The boundary middleware then reads `$response->exception` on the reply and answers, in the api's format, with the role of:

- `AuthenticationException`: `unauthenticated` (401), whether the app rendered JSON or a redirect to `login`;
- `AuthorizationException` (the `can` middleware, a Policy): `forbidden` (403);
- `TokenMismatchException` and `OriginMismatchException` from `PreventRequestForgery`: `csrfInvalid` (403, where Laravel answers 419);
- `ThrottleRequestsException`: `rateLimited` (429), keeping `Retry-After` and the `X-RateLimit-*` headers;
- `PostTooLargeException` from `ValidatePostSize`: `payloadTooLarge` (413);
- the `HttpException` 503 of `PreventRequestsDuringMaintenance`: `serviceUnavailable` (503, grammar 05 roles), keeping `Retry-After`.

A role whose status the operation does not declare is the api's 500. Any other exception that no contract reply rendered is the api's 500 too, in every `responses` mode, as Spring's exception resolver answers it, so Laravel's error page and its debug trace never reach the client; the mapping stays by exception class, so `abort(401|403|429)` from a handler or an app middleware is the api's 500 until laravel-4. A generated exception renders only on a contract request; an exported `renderContractError($request, $exception)` for an app's own handler waits for a consumer that needs it.

### The outgoing response check

The boundary middleware checks the reply of each contract route as it returns through the global stack. That reply comes from whichever writer:

- the boundary's own results and exceptions;
- the app's exception handler and its `render` and `respond` callbacks;
- a native layer's refusal;
- a handler that returned its own `Response`, `JsonResponse` or `StreamedResponse`.

The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's:

- **A declared success** that the boundary wrote passes. A streamed success comes only from a generated result (a download, laravel-4). A `StreamedResponse` carries its status and headers before its callback runs, so the boundary's declared streamed success is passed with its callback wrapped only to catch a failure: the chunks keep the writer's pace (spike, CLI server).
- **An undeclared status** is a violation before any byte is sent, streams included (spike).
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A body in `gzip` or `deflate` is decoded first; a `br` error body, which PHP's zlib extension cannot decode, is a violation, a parity gap listed in Consequences. A streamed error body is buffered by running its callback into the held bytes before the verdict.
- **A reply the boundary did not author.** On a contract route:
  - a success status (a 2xx or a 304) that the boundary did not write is a violation: a handler that returned its own `response()->json()` (spike) or its own `StreamedResponse`;
  - once the access middleware admitted the request, a reply that is neither the boundary's nor a contract exception's rendering is a violation.
- **An ETag** that the boundary did not set is stripped, and a 304 that it did not write is a violation (`frameworkEtag: strip`, the default). Laravel's `cache.headers:etag` middleware adds its own ETag to the boundary's reply object (spike), so the boundary compares the header with the value it wrote.
- **A changed authored reply.** The boundary recognises its reply by object identity, and later middleware or listeners can change that same object. It records the status and the body bytes it wrote, as it records the ETag, and judges a reply whose status or body differs as one it did not author.

Under `strict` a violation is replaced by the api's 500, and `onUnexpectedError` is called. A failure inside a stream's callback, after the headers are sent, cannot be replaced: it is logged, `onUnexpectedError` is called and the body ends short. Under `warn` the reply goes out as written, and the violation is logged once.

The limits are those of ADR 0016: a writer that bypasses the response (`echo` from the handler, `header()`, `exit` or `die`, and `dd()`, whose VarDumper output goes out with a 500 before the process exits) is not seen. An exception thrown inside `Response::send()` itself, after every middleware has returned, is rendered by Laravel's own error page (spike). A reply written by a global middleware the app prepends before the boundary is not seen either; the boot check refuses one, and so does the boundary's first-request assertion.

### Errors raised before the boundary

Before the boundary middleware, only the web server and PHP run: the web server's body limit (nginx `client_max_body_size`), PHP's `post_max_size` for form bodies, and a fatal error during the app's boot. The boot check and the boundary's first-request assertion require the boundary first in the global stack.

Between the boundary and the access middleware, `ValidatePathEncoding`, `PreventRequestsDuringMaintenance` (503, `php artisan down`), `ValidatePostSize`, the session, CSRF, throttle and guard middleware refuse by throwing. Their replies are mapped as "Exceptions on contract routes" says; a refusal the mapping does not name is checked as written.

### Types and validation

Generated value types:

- `final readonly` classes for objects;
- an abstract base class with one final class per variant for unions, with an `Unknown` variant only on input readers;
- backed enums;
- `?T` for an optional or a nullable member, and `seampact/hooks`'s `Field` for a member both optional and nullable, so `{}` and an explicit `null` stay apart (CHK-158);
- `DateTimeImmutable` for a `date-time`, kept with the offset it was sent with;
- integers as `int` in the IR's safe range, checked as whole numbers, so `1.0` is an integer (ADR 0003 Consequences).

Wire names that differ from the PHP property name are carried by the generated decoder and encoder; no attribute library is needed.

The boundary decodes the held body with `json_decode($bytes, false, 512, JSON_THROW_ON_ERROR)`, objects preserved: a body that does not decode as UTF-8 JSON, or nests deeper than 512, is the malformed 400 of step 1. Path, query and headers are decoded by the IR's wire form. Step 6 then runs in the FormRequest:

1. `authorize()` fails closed: unless the request carries the access middleware's mark for the FormRequest's own operation id, it throws the boundary's internal exception before any input is read (never `false`, which Laravel would answer 403), and the reply is the api's 500 with `onUnexpectedError` called. An app route to the interface or to the bound controller, a route without the access middleware, or a request under the `middleware.disable` binding that `withoutMiddleware()` sets in tests, therefore never reaches the handler; the Laravel guide says so for feature tests.
2. `validationData()` returns the boundary's decoded input as arrays, keyed `path`, `query`, `headers` and `body`. `.`, `*` and `~` in a wire name are escaped (`~1`, `~2`, `~0`) in the data and the rule keys, so Laravel's validator reads no wire name as a path (spike); the issue pointer decodes them back.
3. `rules()` returns, per member, `bail` and a generated rule object that checks the member's type on the objects-preserved tree (no coercion, `{}` versus `[]`, whole numbers), then the value rules. Unknown keys, of an object and of the query under `unknownQuery: refuse` (a rule on the `query` part naming the declared parameters), `enum`, `const`, `oneOf` and the discriminator are generated rule objects. The type rule also checks that a required member is there, never Laravel's `required`, which fails on `""` (ADR 0003 Consequences), nor `present`, which fails on a member of an absent optional object or of a parent of another type.
   - A nullable member, at the top level, nested or a `*` item, also gets `nullable` after `bail`, since Laravel runs its non-implicit rules on `null` otherwise. The generated rule objects, which are implicit, accept `null` on a nullable member and pass an absent optional member, so it stays absent.
   - A number or integer member carried as a JSON number that has a Laravel value rule also gets `numeric:strict` after the type rule, so `between`, `size`, `gt`, `gte`, `lt`, `lte` and `multiple_of` compare its value, never the length of its decimal text. `numeric:strict` accepts `1.0`, which `integer:strict` would refuse. An `int64` or `decimal` member carried as a string on the wire never gets `numeric:strict`, which refuses `"42"`: its limits stay generated rules on its decimal text. The body is decoded without `JSON_BIGINT_AS_STRING`, which would turn a large JSON number into the same string as a JSON string, so a JSON integer beyond the `int` range decodes to a float: it is a type issue on a string member, including an `int64` or `decimal` member carried as a string, and read as a float on a `number` member. On an `integer` member, the type rule accepts a float (`is_float()`) only when it is whole and its magnitude is at most 2^53 - 1, the safe range of ADR 0003, such as `1.0`: a whole float whose magnitude is at least 2^63 (so -2^63 too, since `-9223372036854775809` decodes to a float equal to `PHP_INT_MIN`) is 400 `maximum`, or `minimum` below zero, as on the JVM, and a whole float of smaller magnitude above 2^53 - 1 is refused the same way; a JSON integer that fits an `int` decodes to an `int`, never a float, and one above 2^53 - 1 in magnitude is refused as `maximum` or `minimum` too, as on the Node targets. A number the decode makes infinite (`1e400`) is 400 `type` on a `number` member, as on the Node targets, which take only finite numbers. `multipleOf`, which ADR 0003 keeps on `integer` and decimal and refuses on `number`, is checked exactly in both modes: Laravel's `multiple_of` divides by the decimal step, and the generated rule divides by the step's exact integer step, as the Node targets reduce it (`2.5` gives 5); a step whose integer step is beyond the PHP `int` range is refused by name (`multipleOf.wide`).
   - The generated type rule reads presence with `array_key_exists` on the decoded tree, so an explicit `null` and an absent key never look alike.
4. `failedValidation()` throws the generated `schemaInvalid` exception, so the 400 is rendered and Laravel's 422 never is (spike). Each issue carries its `{ in, pointer, rule }`, the contract rule name kept per generated rule, and the issues are bounded by `MAX_RENDERED_ISSUES = 100`.
5. `passedValidation()` runs steps 7 and 8, then builds the typed input that `contractInput()` returns. `validated()` and `safe()` keep Laravel's meaning and return the escaped part arrays; the contract input is `contractInput()`.

With the mark, `authorize()` returns `true`: access ran in steps 2 to 5. `prepareForValidation()` is not overridden.

The target takes `rules` (ADR 0009), as AdonisJS does for its own validators:

- **`native`, the default.** A value rule renders as Laravel's own rule wherever Laravel has one: `min`, `max` and `size` on strings (counted in code points by `mb_strlen`, as the contract counts, spike) and arrays, `between`, `gt`, `gte`, `lt` and `lte` on numbers (behind `numeric:strict`), `multiple_of`, `regex`, `uuid`, `email`, `url`, `ip`. `enum` and `const` stay generated rule objects, since Laravel's `in` compares loosely. A format Laravel has no rule for (`date-time`) stays a generated rule. The Laravel guide lists the differences in a few lines (the `email` rule's RFC validation, `regex` on PCRE).
- **`seampact-consistent`.** Every value rule is a generated rule object with ADR 0003's meaning, patterns searched as ECMA-262 does through the normalised pattern of ADR 0003 section 9, rendered for PCRE with the `u` and `D` modifiers.

In both modes every generated rule object is implicit (`$implicit = true`), since Laravel runs no non-implicit rule on an empty or whitespace-only string (spike). Under `native`, a string member with a length, a pattern or the `uuid` format also gets a generated implicit rule that applies the contract's rule to such a string, so `"   "` never passes a `minLength: 5`, a `pattern` or a `uuid` unchecked.

The contract input is the boundary's decoding, never `$request->input()`. `TrimStrings` and `ConvertEmptyStringsToNull` are skipped on contract routes (spike), so app code that reads `$request->input()` sees the strings as sent. On a `gzip` or `deflate` body, `$request->input()` is empty, since the app's `getContent()` keeps the compressed bytes (spike).

### Query and bounded values

- **Query.** Decoded from the raw `QUERY_STRING` by the IR's wire form, with form decoding (`+` is a space), never from `$request->query`, since PHP's `parse_str` turns `.` and spaces in a name into `_` and reads `a[]` as an array. Zero body bytes is no body. The media type is matched exactly.
- **Body limit.** The boundary refuses a declared `Content-Length` above the route's limit before reading. It reads `php://input` in chunks through `getContent(true)`, decodes `gzip` and `deflate` with ext-zlib's `inflate_add`, counts both the encoded and the decoded bytes, and answers the route's 413 as soon as either passes the limit, chunked bodies included (spike, CLI server).
  - Any other content coding answers 415; a corrupt compressed body is the client's 400.
  - The app's `getContent()` keeps the bytes as received. The boundary's input, and a signed route's raw body, are the decoded bytes.
  - The web server's limit and `post_max_size` must be at least the largest route limit; the Laravel guide says so. The target exports no limit constant.
- **Paging.** The paging roles, `overLimit` included, are validated in step 6, before any paginator is built, since Laravel's page resolver falls back to page 1 on a bad value. `LengthAwarePaginator` and `CursorPaginator` appear only for the `laravelPages` and `laravelCursor` styles of the `pack:laravel` profile (ADR 0008), never as a default shape. Under those styles the handler answers Laravel's paginator, from which the boundary reads the page facts and renders the pack's `{ data, meta }`.
- **Keys.** The throttle bucket key and the idempotency key are fixed-size SHA-256 digests with the same bytes, hex and base64url text as the Node and Spring targets, so keys and ETags are equal across targets. The idempotency key is derived as ADR 0012 obligations say, never from the credentials.
- **Version tokens.** The boundary validates the expected version with the body; the handler compares it with the stored version and answers the operation's `stateConflict` error, as on the other targets. The Laravel guide says what the Node targets' "left to the handler" warnings say.
- **Absolute URLs.** Under `api.wire.urls: absolute`, every URL starts with the configured public origin, `config('seampact.<api>.public_origin')`. The boot check fails without it, and the request host and forwarded headers are never read. Trusted proxies stay the app's own `trustProxies()` setting; they change Laravel's URL helpers, never the boundary.

### Redaction

Every generated class that holds one of the values below gets a generated `__debugInfo()`, and its constructor marks that parameter `#[\SensitiveParameter]`:

- `AuthenticateRequest`'s credentials;
- the CSRF token;
- the members of each identity's generated credentials class;
- a signed request's body, raw and parsed (the `body` of a signed route's input), and its signature header;
- a `sensitive` member.

Each is printed as the generated `[redacted]` constant, since `seampact/hooks` keeps its redaction internal (ADR 0012 obligations, CHK-168).

- `var_dump` and `print_r` read `__debugInfo()`.
- Stack traces and `getTrace()` arguments omit the `#[\SensitiveParameter]` values (spike).
- Symfony VarDumper, behind Laravel's `dump()` and `dd()`, prints the real properties next to `__debugInfo()` (spike). The provider registers a caster for the generated classes in `AbstractCloner::$defaultCasters`, which hides them there too (spike).
- `var_export`, `json_encode` and an `(array)` cast still show them; the Laravel guide says so.

The boundary's own logs, written to the app's PSR-3 logger, carry the operation id, the rule and the pointer, never an input value. A pointer can hold client text (an unknown key's name), so a logged pointer is cut to `MAX_LOGGED_POINTER_BYTES = 256` on a UTF-8 boundary, with its control characters escaped.

### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `handlers`, `perResource` only: `perOperation`, one interface per operation for an `__invoke` controller, waits for an app that needs it (`options.handlers.unsupported`);
- `indent`;
- `routes` (`macro`, the default, or `file`);
- `rules` (`native`, the default, or `seampact-consistent`);
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`).

The naming options of ADR 0007 (`suffixes`, `escape`, `enumCase`) are refused by name (`options.naming.unsupported`): the target names PHP with the ADR 0007 defaults, which the shared naming vectors test. `layout` is refused too (`options.layout.unsupported`): one file per class under the PSR-4 directory is the only layout Composer loads.

Under `routes: macro`, the app writes `Route::seampact('tasks');` in its own routes file, inside its own groups (`web` or `api`). The macro is defined once, whichever api's provider boots first, and looks up the api's generated route table in the container, so two apis share it. Under `routes: file`, the generator writes `routes.php` in the api's directory, one `Route::` line per operation, which the app requires from its own routes file. Both forms register the same routes, survive `route:cache` (spike, macro form) and exclude `PreventRequestForgery` from signed routes, which carry no CSRF token (ADR 0013).

At run time, the generated code reads `config('seampact.<api>.*')`:

- `responses` and `body_validation` for the api;
- `operations.<operationId>.responses` per operation;
- `public_origin`;
- `middleware.<kind>`: the route middleware the registration adds to the routes of each access kind (`public`, `optional`, `identity`, `signed`), empty by default, for the app's own native layers ("Native security layers").

An operation's value wins over the api's value, which wins over the target option. The provider merges the generated defaults (`mergeConfigFrom`) and publishes them as `config/seampact.php` (`php artisan vendor:publish --tag=seampact-config`), whose values call `env()` (`SEAMPACT_TASKS_RESPONSES`). Generated code never calls `env()`, so a `config:cache` built at container start keeps the values (spike).

Hooks are container bindings: authenticate hooks, deciders, scope resolvers and the idempotency store implement the `seampact/hooks` interfaces, narrowed by the generated request classes, and `onUnexpectedError` is an optional binding of a generated interface. The provider resolves them per request, never in a constructor of a long-lived object. A decider names the rights and rules it serves; two claiming one name fail the boot check, no default hook exists, and a missing hook answers 500 (ADR 0012 "Registration and per-right overrides"). The request context, the resolved scopes included, is a request attribute under a generated name (ADR 0012 "Open tenancy").

Two apis are two providers, each with its own middleware, route table and boot check.

### The boot check

The boot check runs in an `$app->booted()` callback of the provider. It runs:

- on an HTTP boot while the routes are not cached, so per request under php-fpm without a route cache. Measured in laravel-2 on the consumer's core operations (10 routes, PHP 8.5, OPcache on): about 0.05 ms per check, lost in the noise of a request's boot of about 10 ms;
- in `route:cache` and `optimize`, in the fresh application they boot after clearing the cache, so a failing check writes no cache file (spike).

It does not run on other artisan commands, so `migrate` and `tinker` work on a broken app, and it does not run on an HTTP boot that reads a route cache, whose routes `route:cache` already checked. It lists every problem at once with the operation id, the name and the fix, and throws, so the app does not serve:

- the hook problems of ADR 0016's list, read from the container's bindings;
- a contract operation without a bound handler (its interface unbound in the container), without a contract route, or with two (the macro called twice);
- an app route registered before a contract route with the same method and URI, which Laravel would match first; other overlaps are left to the run-time 404 of "Routes", which answers when the route Laravel chose is not the raw-matched operation's;
- a route that no generated registration made and that `frameworkRoutes` does not allow-list (FR-25), an app `Route::fallback()` included. The check skips Laravel's own routes, each matched by what Laravel registers, never by path:
  - the health route (`/up` by default), by its action `Illuminate\Foundation\Http\HealthCheck`, since Laravel gives it no name;
  - the routes of a disk served locally (`storage/{path}`), by their names `storage.<disk>` and `storage.<disk>.upload` together with their action, Laravel's local file-serving controller;
  - Sanctum's CSRF cookie route, by its name `sanctum.csrf-cookie`, proved by laravel-4's Sanctum row;
- a route that no generated registration made whose action is a contract interface's method or a method of a class bound to one, whatever `frameworkRoutes` allow-lists and whether that check is on; at run time the FormRequest refuses such a request anyway ("Types and validation");
- a contract route whose URI differs from `mount` followed by the contract path, as when the app wraps the macro in a group prefix that `mount` does not name;
- the boundary middleware not first in the global stack, the access middleware not before `SubstituteBindings` in the priority list, or a contract route without it (`withoutMiddleware`);
- a missing `public_origin` under absolute URLs, or ext-zlib not loaded;
- a Laravel major other than 13, read from `Application::VERSION`; `generate` already refuses older majors from the Composer lock.

`artefacts.bootCheck: false` turns the whole check off; `{ frameworkRoutes: false }` turns the framework-route check off and `{ hooks: off }` the hook check, as on spring-boot (ADR 0011). `{ hooks: warn }` waits for an app that needs it. The handler check runs whenever the boot check does.

### Native security layers

Laravel's layers stay the app's, on the routes the app chooses. The target exports each operation's access in Laravel's native form (ADR 0012 "Native security layers"):

- the route names `seampact.<api>.<operationId>`;
- the `config('seampact.<api>.middleware.<kind>')` lists, which put the app's own middleware (`auth:sanctum` on `identity`) on exactly the routes of one access kind, so a public template `/v1/things/{id}` never shares the middleware of its identity sibling `/v1/things/mine`;
- a generated `TasksAccess` table, keyed by route name, giving each operation's access kind, identity, requirements and scopes.

Their refusals are mapped to roles as "Exceptions on contract routes" says. Without `Sec-Fetch-Site: same-origin` or a token, the `web` group's `PreventRequestForgery` refuses an unsafe method, answered as `csrfInvalid` (spike). An API-only app without a `login` route sets `redirectGuestsTo()` to return `null` on contract routes, and the guide shows it; otherwise `Authenticate` throws `RouteNotFoundException` while building its own exception, and the reply is the api's 500 (spike).

Laravel answers the hooks as application code, with no adapter package in 1.0 except `seampact/laravel-spatie` later (ADR 0012 "Optional adapters"):

- an authenticate hook reads the user from the configured guard (`Auth::guard('sanctum')->user()`); the access middleware runs after the session, so session guards work;
- a decider asks the Gate for the principal (`Gate::forUser($user)->authorize('update', $task)`), and the `AuthorizationException` it throws answers the first declared denial code;
- on an optional-auth route with `onRefused: anonymous`, the app leaves `auth` off the `optional` kind, and the hook answers anonymous when the guard has no user.

### Native access instead of hooks

With `artefacts: { accessHooks: false }` and `access: { native }` (ADR 0012 "Native access instead of hooks"):

- the target generates no hook interfaces and no steps 2 to 5; the access middleware keeps its route check and marks the request, so the FormRequest still runs only behind it;
- it exports the `TasksAccess` table and the per-kind middleware lists above, for the app's `can` middleware and Policies;
- an operation that needs a principal at the boundary is refused by `generate`, as ADR 0012 says.

### What the shape-imposing features turn off with

The target imposes no wire shape ([A36](../decisions.md#a36)). Each feature that adds behaviour beyond the contract has a switch:

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| Laravel's own value rules | native | `rules: seampact-consistent` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ frameworkRoutes, hooks }` |
| API Resources and paginators | never by default | the contract's `pack:laravel` format and paging styles |

The error format is the api's declared format; `pack:laravel` keeps errors bare problem+json (ADR 0008). Laravel ships no OpenAPI generator, so the target declares no `nativeDocs` artefact and reads no `frameworkDocs`: the app config refuses both keys by name (`config.artefacts.unknown`).

### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own types and rules in PHP, since no PHP provider exists in 1.0. A link on its entry fails `generate` with `link.kind.not-consumed`, naming the entry and the link. It generates no client: the consumer's suite drives the routes over HTTP, and a PHP client waits for a consumer that needs one.

### What the generated code depends on

At run time:

- PHP `>=8.3.36 <8.4 || >=8.4.27 <8.5 || >=8.5.12`, the releases carrying the October 2026 fixes (CVE-2026-109618 and CVE-2026-109619), so Composer refuses an unpatched runtime; ext-json, ext-mbstring and ext-zlib;
- `laravel/framework` 13 (routing, validation, the HTTP kernel, the container), and Symfony VarDumper, which it brings, for the caster;
- `seampact/hooks`.

The boundary runtime is copied into `Laravel\Runtime` with the generated header, as the other targets copy theirs (ADR 0015 "Runtime helpers"). Generated code imports no seampact package other than `seampact/hooks`, no validation or serializer library, and no Laravel package beyond the framework (Sanctum, Octane and spatie stay the app's). `seampact/laravel` is a `require-dev` package (ADR 0010); its artisan command is registered by Laravel's package discovery. Generated files print through `nette/php-generator`'s `PsrPrinter` (ADR 0015) and pass `php -l` and PHPStan at level max on 8.3 and 8.5.

### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the delivered PRs do not serve ([A47](../decisions.md#a47)), each with the PR that brings it. It reads only the operations the target entry's `operations` filter keeps (ADR 0011): a form that no kept operation carries is neither generated nor refused.

| Waits for | What |
|---|---|
| laravel-2 | rights and rules an operation requires, which the access middleware runs, rule proof fields in the body (`recentAuth` on purgeTask), `artefacts.bootCheck` and `artefacts.accessHooks: true` |
| laravel-3 | paging, its structured `sort` query parameter (listTasks) and its `page` response, idempotency replay, throttle, cache and ETag headers, the response headers these features derive, retry headers, signed routes and their raw body, absolute URLs, deadline budgets (`budgetMs`), relayed operations (`relays`), sensitive values and the error codes that forbid caching (`noStore`, refused by name until then), opaque values (`PaymentEvent.data` on payments), the `pack:laravel` styles |
| laravel-4 | the mapping of `abort(401|403|429)` from a handler or an app middleware, revisited with Guards and Gates; multipart (`file`, `mimetypes` and `max` rules; PHP stores an upload before any PHP code runs, so the boundary refuses a `Content-Length` above the route limit and `post_max_size` bounds the rest), download (`response()->streamDownload()`) and redirect (`redirect()->to()`) bodies, native access (`artefacts.accessHooks: false`), the per-kind middleware lists, the published config |
| a consumer that needs them | form bodies (ADR 0012 bodies table), refused by name as on every Node target: the reference contract carries none; unions (`oneOf`), designed above, until a contract needs one |
| after 1.0 | Laravel 12 and older (refused, not waiting); Octane (refused, below); `hooks: vendored` ([A40](../decisions.md#a40)); every IR form absent from the reference contract's golden IRs, as the Spring target refuses them: `list` responses, response headers the route writes itself, principal requirements, bindings, upstream calls, operation features, extension keys, input field rights below the top level, scope ids not read from the path, bucket keys not read from the path, a scope or the principal, rule proofs outside the body, principals of several variants, signatures verified by the application or keyed from the request, parameter and property defaults, open enums, maps, `int64` and `decimal`, kept unknown keys |

Octane is refused at run time, outside the boot check, since an Octane app usually serves from a route cache, where the boot check does not run. The provider's `boot()` listens for Octane's `Laravel\Octane\Events\WorkerStarting`, named as a string so the generated code needs no Octane package, and throws `runtime.octane.unsupported` with the fix "serve the app with php-fpm, or keep this api's provider out of the Octane app": the worker does not start.

### The consumer and the proof

The sample app lives in `scripts/consumers/targets/laravel/`. It is a Laravel 13 skeleton that holds the developer's controllers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a `MessageLogged` listener. Each request of PHP's built-in server starts from nothing, so the script, the hook calls and the log lines live in one file under `storage/`. It reads the template's credentials from the shared JSON. It installs `seampact/hooks`, `seampact/laravel` and `seampact/ir` from Composer path repositories pointing at the split trees (ADR 0011 "Unpublished installs for test consumers"), and the reference contract's bundle that the workflow built.

The workflow `p6-laravel.yml` has, beside `changes` and the `packages` tests:

- `contract-bundle` (Node), which bundles the reference contract with the compiler binary (ADR 0011 "The bundle"); the consumer fetches it from a local git repository with its integrity pin;
- `e2e`, a matrix on the latest PHP 8.3 and 8.5, both pull-request rows. Node is removed from the runner first, and the step fails if `node`, `npm` or `npx` is still found. It installs the app and its allow-listed variant with Composer only, generates from the bundle and runs `route:cache` and `config:cache`. Node then comes back for the suite alone, which serves the app with PHP's built-in server (`php -S`, no php-fpm or nginx) and runs the `default`, `hand-written` and `boot` profiles, plus `pack:laravel` from laravel-3, as the spring-boot consumer runs them (ADR 0015 "Suite profiles"); a boot is `route:cache`, which runs the boot check. The local-YAML rows, through the compiler binary, come with php-core-4;
- `laravel`, the aggregate, failing on any failed or cancelled job, or one skipped although `changes` said run.

The proof is:

- the `node`-absent step;
- a green suite row per PHP version;
- the consumer's `RedactionTest.php` (one class of each kind of "Redaction" holding a known secret, which `var_dump`, `print_r` and VarDumper must not show while `[redacted]` is present) and the suite's security and media rows, a Sanctum route among them.

Suite cases that wait for a later PR carry a refusal naming that PR; the list is empty at laravel-4.

### Delivery

| PR | Delivers |
|---|---|
| laravel-1 | `php/laravel` (`Seampact\Laravel`) and the shared emitters and form walk of `php/codegen` (`Seampact\Codegen`), where each PHP target names the release that brings a refused form: the generator class registered in `extra.seampact.generator`, the options (`routes`, `rules` and the rest), readonly classes with `Field`, controller interfaces, FormRequests with their rules, the routes file and the macro's route table, the exceptions per error; a golden for the reference contract, linted with `php -l` and PHPStan max on PHP 8.3 and 8.5 |
| laravel-2 | the boundary middleware (steps 1 and 10, the "boundary first" assertion), the access middleware (steps 2 to 5 and its mark), the FormRequest steps 6 to 8 failing closed without that mark, the mapping of "Exceptions on contract routes", the provider with its hook bindings and the Octane refusal, rule proof fields in the body, scopes in request attributes, the 500 on a missing hook, the boot check, `php artisan seampact:generate`; the sample app with path repositories under PHP's built-in server, the `default`, `hand-written` and `boot` profiles on the core operations, the e2e job of `p6-laravel.yml`; `BootCheckTest.php` only for a rule that is a brick |
| laravel-3 | paging with its `sort` parameter, idempotency, throttle, cache headers and the response headers of these features, retry headers, the signed raw body, absolute URLs, deadline budgets and relayed operations, opaque values, redaction (`__debugInfo()`, `#[\SensitiveParameter]`, the VarDumper caster), the `pack:laravel` profile; the pack and full suite profiles and `RedactionTest.php` |
| laravel-4 | guards and Sanctum for authenticate, Gates and Policies for decide, native access (`artefacts.accessHooks: false`), `AuthorizationException` in a decider answering the first denial code, coexistence with the native layers and their per-kind middleware lists, multipart, `streamDownload` and `redirect()->to()`, the published `config/seampact.php`; the suite's security and media rows, a Sanctum row in the sample app |

## Spike

Run on Laravel 13.38.0 (a fresh `laravel/laravel` skeleton, Symfony HttpFoundation and VarDumper 8.1.9) on PHP 8.5.4 CLI under `php artisan serve` with four workers, and not kept. PHP 8.3, php-fpm behind a web server, Sanctum and Octane were not run. The results marked "CLI server" (the base path from the server variables, stream pacing, the chunked bounded read) depend on the server; laravel-2's suite runs them under the same built-in server; no row runs php-fpm. A reduced boundary had:

- a global middleware placed first, with a raw-path matcher, a bounded body read with gzip decoding, the authored-reply mark and the exception mapping;
- a route middleware placed before `SubstituteBindings`;
- a FormRequest with generated type rules on the objects-preserved tree and Laravel value rules;
- seven routes from a macro in the `web` group, one with `throttle:2,1`, one with `auth`, one with `cache.headers:etag`, a signed route without `PreventRequestForgery`.

Requests were sent with curl.

| Case | Result |
|---|---|
| route middleware order (`gatherRouteMiddleware`), registered from `bootstrap/app.php` and then from a provider through the kernel | `EncryptCookies`, `AddQueuedCookiesToResponse`, `StartSession`, `ShareErrorsFromSession`, `PreventRequestForgery`, `ThrottleRequests` or `Authenticate`, the access middleware, `SubstituteBindings`; the global stack began with the boundary, before `ValidatePathEncoding` and `TrustProxies` |
| FormRequest on `PUT /v1/tasks/7` | `authorize`, `validationData`, rules, `failedValidation` or `passedValidation`, then the handler |
| `max:3` on three emoji; `regex:/b/u` on `"abc"`; `"5"` for an integer; `{}` for an array; `[]` as the body | passed; passed (a search); caught only by the generated type rule, with `bail` keeping it the only issue; caught on the objects-preserved tree; one type issue |
| `""` and `"   "` under `min:1`, `min:5` and `regex:/^b$/` | no rule ran; a rule with `$implicit = true` ran |
| `null` under `min:5` and `regex:/^b$/u`, without and with `nullable` | refused; passed |
| `15` under `between:10,20` and `50` under `between:1,10`, without and with `numeric:strict`; `1.0` under `numeric:strict` and under `integer:strict` | refused and passed (the text's length compared); passed and refused; passed; refused |
| a key `a.b` with `array:a.b`; keys escaped `a~1b`, `tags~2`, `a~0b` | the validator replaced the dot, `array:` failed and the attribute read `body.a.b`; every rule ran and `failed()` returned the escaped keys |
| a generated exception with `render()`; the same with an app `render(Throwable)` catch-all | 409 by its own `render()` in both cases |
| `failedValidation()` throwing the generated exception | the 400, no 422 |
| `response()->json()` from the handler; `abort(418)`; the app's `$request->validate()` failing | each marked not authored and replaced by 500 |
| no CSRF token and no `Sec-Fetch-Site`; a third request under `throttle:2,1`; `auth` with `Accept: application/json` | `TokenMismatchException` (419) mapped to 403 `csrfInvalid`; `ThrottleRequestsException` mapped to 429 with `Retry-After: 60`; `AuthenticationException` mapped to 401 |
| `auth` with a browser `Accept`, without and with a `login` route | `RouteNotFoundException` while `Authenticate` built its exception, a 500; a redirect carrying `AuthenticationException`, mapped to 401 |
| `Gate::authorize()` denying inside the access middleware | `AuthorizationException` on the reply, mapped to 403 |
| `cache.headers:etag` on a boundary reply | the middleware added its md5 ETag to the same reply object |
| `/v1/tasks/%73earch`; `POST /v1/tasks:batch`; `GET /v1/tasks:batch` | the search route while the raw match was `{p1}`, answered 404 by the access middleware; the batch route; 404 from the boundary |
| `/v1/tasks/7/`, `/v1//tasks/7`, `x/../7` | 404 from the boundary before routing |
| `a%2Fb`; `%E0%A4%A`; `%2e%2e`, `7;x=1`, `%ZZ` | no route for the decoded `a/b` (`NotFoundHttpException`); `MalformedUrlException` 400 from `ValidatePathEncoding`; routed to `{p1}` as values |
| `HEAD`; `OPTIONS` and `DELETE` on a `GET` path; a CORS preflight | the `GET` route, no body; 404 from the boundary; passed to the app, 200 |
| a signed route body `{"note":"  x  ","e":""}` | `getContent()` exact, `input('note')` untrimmed with `skipWhen` |
| `Content-Length` over the limit; chunked over the limit; a gzip body | 413 before reading; 413 while reading; decoded to the boundary's input, the app's `getContent()` the gzip bytes |
| a `StreamedResponse` with three chunks 300 ms apart: plain, with its callback in a `try`, in `ob_start($callback, 1)`; an undeclared 206 stream | at 0, 300 and 600 ms; same; all at the end; 500 before any byte |
| a header with a NUL byte sent by `Response::send()` | escaped every middleware, Laravel's error page |
| a failing boot check in `$app->booted()` during `route:cache`; `route:list` over a cache | `route:cache` failed and wrote no cache; the check skipped, `booted` saw no routes yet |
| `config:cache` with `SEAMPACT_TASKS_RESPONSES=warn` in the environment | `config()` gave `warn`, `env()` gave `null` |
| an interface bound to the controller as the route action, under `route:cache` | resolved through the container |
| `var_dump`, `print_r`, `getTrace()` args, VarDumper, VarDumper with a default caster, `var_export`, `json_encode`, `(array)` | hidden; hidden; hidden; shown; hidden; shown; shown; shown |
| a subdirectory front controller | `getBaseUrl()` `/sub/index.php`, `getPathInfo()` the contract path |

Read from the sources, not run: `Illuminate\Routing\Pipeline::handleException` renders and calls `withException()`; `Handler::render()` calls the exception's `render()` before the render callbacks; Laravel 13's `TrustProxies` trusts `X-Forwarded-Prefix` by default; `PreventRequestForgery` accepts `Sec-Fetch-Site: same-origin` and, with `originOnly`, throws `OriginMismatchException`; the framework's default guest redirect is `route('login')`.

## Consequences

- A body with an object key that starts with a NUL byte is the malformed 400 here, since PHP cannot hold that key as a property name; the Node and JVM targets accept it.
- An app keeps its controllers, its exception handler, its middleware groups, its guards, Gates and Policies. On contract routes the boundary's checks and reply win, and its own routes are unchanged.
- The check order holds in Laravel without app setup beyond listing the provider and calling the macro: route-model binding, `TrimStrings` and `$request->input()` never decide a contract input.
- Every reply on a contract route is checked, from whichever writer, streams included, except an exception thrown inside `Response::send()` and the writers that bypass the response (`echo`, `header()`, `exit`, `dd()`).
- A native layer's refusal that the operation declares answers in the api's format; Laravel's 419 for CSRF becomes the contract's 403.
- A path value whose percent-decoding is not UTF-8 is refused before steps 2 to 5 run, and `%2F` in a segment answers the path's 404; the Node targets pass both to step 6.
- A `br` error body is a violation here, where ADR 0016 decodes it.
- A multipart body cannot be counted as it arrives: PHP stores the upload before the app runs. The boundary refuses a declared `Content-Length` above the route limit, and `post_max_size` and the web server's limit bound the rest, the Laravel exception that ADR 0012's obligations state.
- Under `rules: native`, Laravel's value rules give their own verdicts, listed in the Laravel guide; a blank string never escapes a length or pattern rule.
- `dump()` and `dd()` hide sensitive values through the provider's caster; `var_export`, `json_encode` and `(array)` do not.
- Without a route cache the boot check runs on every request; production apps run `route:cache` and `config:cache` at deploy or container start.
- Laravel 12 apps and Octane workers cannot use the target in 1.0; an Octane worker that loads a seampact provider refuses to start.
- ADR 0012's laravel row is amended to match: steps 1 and 10 run in a global middleware and steps 2 to 5 in a route middleware, for the reasons in Options.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, controllers stay the developer's), FR-21 (PHP targets), FR-25 (framework routes and the boot check), FR-35 (the shared suite); CHK-083, CHK-158, CHK-159, CHK-168; amendments A9, A15, A25, A30, A36, A40, A41, A42, A47.
- ADRs: 0003 (the PHP decoding and rule mapping), 0007 (PHP names), 0008 (`pack:laravel`), 0009 (artefacts, `rules`, matrix), 0010 (artifacts, namespaces), 0011 (app config, unpublished installs), 0012 (placement and obligations), 0013 (raw body), 0015 (runtime copies, golden tests, suite profiles), 0016 and 0022 (the shared obligations and the placement this one mirrors).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the Laravel consumer.

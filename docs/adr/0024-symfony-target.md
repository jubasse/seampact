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
- The boot check: in a compiler pass, in a non-optional cache warmer, or in a compiler pass for the container with a decorator of the routing loader for the routes. Choice: the pass and the decorator for the container and the routes, and a non-optional cache warmer for the hooks. A compiler pass cannot see the routes, which the router loads apart from the container, nor ask the hooks their names without building services. A failing pass writes no container, and a failing route check writes no router cache, so in both cases the app does not serve (spike). A cache warmer runs only once the container is written and only when the container is rebuilt.

## Decisions

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File |
|---|---|
| Placement | [0024-symfony-target/01-placement.md](0024-symfony-target/01-placement.md) |
| Routes | [0024-symfony-target/02-routes.md](0024-symfony-target/02-routes.md) |
| The reply path | [0024-symfony-target/03-the-reply-path.md](0024-symfony-target/03-the-reply-path.md) |
| Exceptions on contract routes | [0024-symfony-target/04-exceptions-on-contract-routes.md](0024-symfony-target/04-exceptions-on-contract-routes.md) |
| The outgoing response check | [0024-symfony-target/05-the-outgoing-response-check.md](0024-symfony-target/05-the-outgoing-response-check.md) |
| Errors raised before the boundary | [0024-symfony-target/06-errors-raised-before-the-boundary.md](0024-symfony-target/06-errors-raised-before-the-boundary.md) |
| Types and validation | [0024-symfony-target/07-types-and-validation.md](0024-symfony-target/07-types-and-validation.md) |
| Query and bounded values | [0024-symfony-target/08-query-and-bounded-values.md](0024-symfony-target/08-query-and-bounded-values.md) |
| Redaction | [0024-symfony-target/09-redaction.md](0024-symfony-target/09-redaction.md) |
| Options and registration | [0024-symfony-target/10-options-and-registration.md](0024-symfony-target/10-options-and-registration.md) |
| The boot check | [0024-symfony-target/11-the-boot-check.md](0024-symfony-target/11-the-boot-check.md) |
| Native security layers | [0024-symfony-target/12-native-security-layers.md](0024-symfony-target/12-native-security-layers.md) |
| Native access instead of hooks | [0024-symfony-target/13-native-access-instead-of-hooks.md](0024-symfony-target/13-native-access-instead-of-hooks.md) |
| What the shape-imposing features turn off with | [0024-symfony-target/14-what-the-shape-imposing-features.md](0024-symfony-target/14-what-the-shape-imposing-features.md) |
| Links and the client | [0024-symfony-target/15-links-and-the-client.md](0024-symfony-target/15-links-and-the-client.md) |
| What the generated code depends on | [0024-symfony-target/16-what-the-generated-code-depends.md](0024-symfony-target/16-what-the-generated-code-depends.md) |
| Refused by name or waiting | [0024-symfony-target/17-refused-by-name-or-waiting.md](0024-symfony-target/17-refused-by-name-or-waiting.md) |
| The consumer and the proof | [0024-symfony-target/18-the-consumer-and-the-proof.md](0024-symfony-target/18-the-consumer-and-the-proof.md) |
| Delivery | [0024-symfony-target/19-delivery.md](0024-symfony-target/19-delivery.md) |

## Spike

Run on Symfony 7.4.21 and 8.1.9 (fresh `symfony/skeleton` apps with SecurityBundle, Validator, Serializer and RateLimiter) on PHP 8.5.4 under the PHP CLI server, and not kept. Both majors gave the same result on every case. PHP 8.3, php-fpm, FrankenPHP, WebProfilerBundle and NelmioCorsBundle were not run. The results marked "CLI server" (the chunked bounded read) depend on the server: the consumer is served by that same built-in server, so they stay proven on it only. A reduced boundary had:

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

- App input rules ([ADR 0028](0028-app-input-rules.md)): Symfony: step 8b runs at the handler call over the autoconfigured `<Api>InputRules` classes, validating the typed part with `validate($part, $constraints)`; the PHP reverse walker maps property paths to wire pointers.
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

- History: the dated amendments this ADR carried until PR #451 are folded into the sections they changed; `git show 43055be4:docs/adr/0024-symfony-target.md` holds them with their dates.
- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, controllers stay the developer's), FR-21 (PHP targets), FR-25 (framework routes and the boot check), FR-35 (the shared suite); CHK-084, CHK-158, CHK-168, CHK-174; amendments A9, A15, A25, A30, A36, A40, A41, A42, A47.
- ADRs: 0003 (the PHP decoding and rule mapping), 0007 (PHP names), 0009 (artefacts, `rules`, matrix), 0010 (artifacts, namespaces), 0011 (app config, unpublished installs), 0012 (placement and obligations), 0013 (raw body), 0015 (runtime copies, golden tests, suite profiles), 0016 and 0023 (the shared obligations and the PHP target this one mirrors).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the Symfony consumer.

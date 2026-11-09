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

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File |
|---|---|
| Placement | [0023-laravel-target/01-placement.md](0023-laravel-target/01-placement.md) |
| Routes | [0023-laravel-target/02-routes.md](0023-laravel-target/02-routes.md) |
| The reply path | [0023-laravel-target/03-the-reply-path.md](0023-laravel-target/03-the-reply-path.md) |
| Exceptions on contract routes | [0023-laravel-target/04-exceptions-on-contract-routes.md](0023-laravel-target/04-exceptions-on-contract-routes.md) |
| The outgoing response check | [0023-laravel-target/05-the-outgoing-response-check.md](0023-laravel-target/05-the-outgoing-response-check.md) |
| Errors raised before the boundary | [0023-laravel-target/06-errors-raised-before-the-boundary.md](0023-laravel-target/06-errors-raised-before-the-boundary.md) |
| Types and validation | [0023-laravel-target/07-types-and-validation.md](0023-laravel-target/07-types-and-validation.md) |
| Query and bounded values | [0023-laravel-target/08-query-and-bounded-values.md](0023-laravel-target/08-query-and-bounded-values.md) |
| Redaction | [0023-laravel-target/09-redaction.md](0023-laravel-target/09-redaction.md) |
| Options and registration | [0023-laravel-target/10-options-and-registration.md](0023-laravel-target/10-options-and-registration.md) |
| The boot check | [0023-laravel-target/11-the-boot-check.md](0023-laravel-target/11-the-boot-check.md) |
| Native security layers | [0023-laravel-target/12-native-security-layers.md](0023-laravel-target/12-native-security-layers.md) |
| Native access instead of hooks | [0023-laravel-target/13-native-access-instead-of-hooks.md](0023-laravel-target/13-native-access-instead-of-hooks.md) |
| What the shape-imposing features turn off with | [0023-laravel-target/14-what-the-shape-imposing-features.md](0023-laravel-target/14-what-the-shape-imposing-features.md) |
| Links and the client | [0023-laravel-target/15-links-and-the-client.md](0023-laravel-target/15-links-and-the-client.md) |
| What the generated code depends on | [0023-laravel-target/16-what-the-generated-code-depends.md](0023-laravel-target/16-what-the-generated-code-depends.md) |
| Refused by name or waiting | [0023-laravel-target/17-refused-by-name-or-waiting.md](0023-laravel-target/17-refused-by-name-or-waiting.md) |
| The consumer and the proof | [0023-laravel-target/18-the-consumer-and-the-proof.md](0023-laravel-target/18-the-consumer-and-the-proof.md) |
| Delivery | [0023-laravel-target/19-delivery.md](0023-laravel-target/19-delivery.md) |

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

- App input rules ([ADR 0028](0028-app-input-rules.md)): Laravel: step 8b runs at the handler call over the classes tagged `seampact.<api>.input_rules`, validating the part rebuilt as a wire-keyed array with `Validator::make`; `IdempotencyStep::abandon` releases the claim.
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

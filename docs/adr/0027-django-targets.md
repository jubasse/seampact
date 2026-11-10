# ADR 0027: The Django targets

Status: accepted

## Context

[A48](../decisions.md#a48) puts Django REST Framework and Django Ninja in v1, on the Python core of ADR 0026. Both run inside Django: the same middleware stack, URLconf, settings and exception handling. So this ADR states three things:

- the shared Django layer, `seampact-django`: the boundary middleware, the routes, the exception map, the settings, the system check, the boot check, and the `seampact_generate` and `seampact_check` commands;
- the DRF target, `seampact-drf`;
- the Ninja target, `seampact-ninja`, in its own section. Cutting Ninja removes that section, `python/ninja`, its workflow and its consumer, and nothing else.

What this ADR does not restate holds as ADR 0026 says for the Python core, and as ADR 0016 and ADR 0023 say for every server target.

Nine Django, DRF and Ninja behaviours shape the placement (spike):

- Django builds the middleware chain once, when the handler is built: in `get_wsgi_application()` and `get_asgi_application()`, so while gunicorn or uvicorn imports the app, and at the first request of the test `Client`. `manage.py check` builds no handler. A middleware `__init__` that raises stops gunicorn ("Worker failed to boot."), uvicorn and `runserver`.
- Django wraps each middleware and the view. An exception raised inside becomes a reply before any outer middleware sees it: `Http404` goes to `handler404(request, exception)`, `PermissionDenied` to `handler403`, `BadRequest` and every `SuspiciousOperation` (`RequestDataTooBig`, `DisallowedHost`) to `handler400`. Any other exception sends `got_request_exception`, with the exception in `sys.exc_info()`, then calls `handler500(request)`. Under `DEBUG`, `Http404`, `BadRequest` and `SuspiciousOperation` get Django's technical pages, and no handler runs.
- Django decodes the path before routing (`path_info`). The raw target is the WSGI `RAW_URI` (gunicorn) or the ASGI `raw_path` (uvicorn); `runserver` gives none. Django routes `path_info`, which never holds the script name.
- Django tries URL patterns in order. `resolve()` is public, and `include()` and `i18n_patterns()` add prefixes.
- Under WSGI, Django reads no body without `Content-Length`: a chunked body arrives empty, while gunicorn's `wsgi.input` decodes it. Under ASGI, Django spools the whole body to a temporary file before the first middleware runs. `request.body` refuses a `Content-Length` above `DATA_UPLOAD_MAX_MEMORY_SIZE` with `RequestDataTooBig`, a 400, and after `request.read()` it raises `RawPostDataException`.
- A middleware that is both sync and async capable runs async only when every middleware inside it is async capable. Otherwise Django runs it sync, in a thread under ASGI.
- DRF's `APIView` is CSRF exempt. Its `initial()` runs content negotiation, versioning, authentication, permissions and throttles, in that order, then the method. Every exception of `initial()` and of the method goes to the view's `get_exception_handler()`, which defaults to the `EXCEPTION_HANDLER` setting. `SessionAuthentication` checks CSRF only for a session user and raises `PermissionDenied`.
- Ninja runs `auth=` and throttles before the view, and sends every exception to `NinjaAPI.on_exception`, which picks a handler by the exception's class hierarchy. A Ninja `GET` operation answers `HEAD` with 405. A view that declares no parameter gets no parsing.
- `override_settings(MIDDLEWARE=...)` without the boundary, and DRF's `APIRequestFactory` or Django's `RequestFactory` calling a view directly, reach the view with no boundary.

## Options

- Step 1 and the outgoing check: a Django middleware first in `MIDDLEWARE`, or a WSGI and an ASGI wrapper around the handler. Choice: the middleware. It runs the same under gunicorn, uvicorn, `runserver` and the test `Client`, sync or async. A wrapper misses the test `Client` and needs two forms.
- Recording the exception behind a reply: a `process_exception` hook, the `django.request` log records, or the root URLconf's error handlers plus `got_request_exception`. Choice: the handlers and the signal. `process_exception` sees only view exceptions, and only when no inner middleware answered first. The log records miss `Http404`.
- DRF steps 2 to 5: in DRF authentication and permission classes, or in the generated `APIView` after `initial()`. Choice: after `initial()`. The app's DRF classes run first as its native layer, so a hook can read the user they set.
- DRF step 6: Pydantic, or DRF serializers. Choice: serializers, behind the generated type layer. A DRF app keeps its own field rules and messages, and `seampact-drf` needs no Pydantic.
- Boot check: in `AppConfig.ready()`, in a system check, or in the boundary's `__init__`. Choice: a system check that warns, the boundary's `__init__` that refuses, and a `seampact_check` command for CI. `ready()` runs for every command, `shell` included, so a broken api would stop them all. A warning keeps `migrate` running on a broken app, as on Laravel. The boundary's `__init__` runs at every server start and at the test `Client`'s first request.

## Decisions

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File | Contains |
|---|---|---|
| The shared Django layer | [0027-django-targets/01-the-shared-django-layer.md](0027-django-targets/01-the-shared-django-layer.md) | Distributions; Versions; Sync and async; Settings; The boundary middleware; Generated modules; Routes; The reply path; Exceptions on contract routes; The outgoing response check; Errors raised before the boundary; Test doubles; The system check and the boot check |
| DRF | [0027-django-targets/02-drf.md](0027-django-targets/02-drf.md) | Placement; Exceptions; Types and validation; Native docs |
| Ninja | [0027-django-targets/03-ninja.md](0027-django-targets/03-ninja.md) | Placement; Exceptions; The boot check; Native docs |
| Redaction | [0027-django-targets/04-redaction.md](0027-django-targets/04-redaction.md) |  |
| Options and registration | [0027-django-targets/05-options-and-registration.md](0027-django-targets/05-options-and-registration.md) |  |
| What the shape-imposing features turn off with | [0027-django-targets/06-what-the-shape-imposing-features.md](0027-django-targets/06-what-the-shape-imposing-features.md) |  |
| Links and the client | [0027-django-targets/07-links-and-the-client.md](0027-django-targets/07-links-and-the-client.md) |  |
| What the generated code depends on | [0027-django-targets/08-what-the-generated-code-depends.md](0027-django-targets/08-what-the-generated-code-depends.md) |  |
| Refused by name or waiting | [0027-django-targets/09-refused-by-name-or-waiting.md](0027-django-targets/09-refused-by-name-or-waiting.md) |  |
| The consumer and the proof | [0027-django-targets/10-the-consumer-and-the-proof.md](0027-django-targets/10-the-consumer-and-the-proof.md) |  |
| Delivery | [0027-django-targets/11-delivery.md](0027-django-targets/11-delivery.md) |  |

## Spike

Run on CPython 3.12.16 with gunicorn 26.2.0 and uvicorn 0.54.0, and not kept, in three environments: Django 5.2.18 with DRF 3.18.0 and Ninja 1.4.0; Django 6.1.2 with DRF 3.18.3 and Ninja 1.7.3; Django 6.1.2 with DRF 3.18.0 and Ninja 1.4.0, then 1.4.5, 1.5.0 and 1.5.3. Pydantic 2.14.2 throughout. A reduced app had a recording boundary first in `MIDDLEWARE`, Django's usual middleware, an inner middleware that raised on demand, recording root URLconf handlers, DRF views with recording authentication, permission and throttle classes, and a Ninja api. Requests went through the test `Client`, and through raw sockets to gunicorn, uvicorn and `runserver`. Every row gave the same result in every environment, except the Ninja 1.4.0 row.

| Case | Result |
|---|---|---|
| `ImproperlyConfigured` in the boundary's `__init__` | gunicorn: "Worker failed to boot.", the master stops; uvicorn: exit 1 while importing the app; `runserver`: stops; test `Client`: raises at the first request; `manage.py check`: passes |
| an inner middleware raises `Http404`, `PermissionDenied`, `SuspiciousOperation`, `RequestDataTooBig`, `BadRequest`, `DisallowedHost`, `ValueError` | 404 through `handler404`, 403 through `handler403`, 400 through `handler400` four times, each with the exception; 500 after `got_request_exception` with the exception in `sys.exc_info()`. The boundary saw replies only |
| the same under `DEBUG` | technical pages and no handler for `Http404`, `SuspiciousOperation` and `BadRequest`; `handler403` still called |
| DRF `initial()` | content negotiation, versioning, authentication, permissions, throttles, then the method |
| a view's `get_exception_handler()` beside `EXCEPTION_HANDLER` | the view's handler received every exception of `initial()` and the method; the setting's was never called |
| `NotAuthenticated`, `AuthenticationFailed`, `SessionAuthentication` first | 403, no `WWW-Authenticate` |
| a session user's `POST` without a CSRF token; an anonymous one | `PermissionDenied` raised during authentication; served |
| `HEAD`, `OPTIONS`, `PUT` on an `APIView` with `get` only | 200 with `get`; 200 metadata; 405 |
| serializer fields `data`, `errors`, `fields` from `get_fields()`; as class attributes | validated and keyed by name; served at run time, three `mypy --strict` errors with the DRF stubs |
| `Content-Length` above `DATA_UPLOAD_MAX_MEMORY_SIZE` read by `request.body`; `request.read(10)` then `request.body` | `RequestDataTooBig`, 400; `RawPostDataException`, 500 |
| a chunked `POST` without `Content-Length` | gunicorn and `runserver`: `request.body` empty, gunicorn's `wsgi.input` decoded; uvicorn: the whole body |
| `/v1/tasks/%73earch`, `a%2Fb`, `7%3Bx=1`, `%2e%2e`, a query | gunicorn `RAW_URI` and uvicorn `raw_path` as sent (`RAW_URI` with the query); `runserver` none; routed to search, to no route, and `7;x=1` and `..` as values |
| gunicorn `SCRIPT_NAME=/api`; uvicorn `--root-path /api`; `FORCE_SCRIPT_NAME=/fx` | raw target with `/api`, `path_info` without; the same; under WSGI raw target and `path_info` unchanged, under ASGI `path_info` stripped only when the path starts with `/fx` |
| the boundary under uvicorn with a sync-only inner middleware; with async-capable ones only | sync; async |
| `resolve()` with a `re_path` catch-all, a DRF `DefaultRouter`, an `include("pre/")`, `i18n_patterns` | the catch-all took every path; the router took `/v1/tasks/x.json` and `/v1/tasks/`, and `APPEND_SLASH` redirected `/v1/tasks`; `/v1/tasks/x` did not resolve; with the default language unprefixed, `/en/` and `/fr/` paths also reached the contract view |
| `override_settings(MIDDLEWARE=...)` without the boundary; `APIRequestFactory` and `RequestFactory` calling the view | the view served 200 with no boundary |
| Ninja `auth=` failure; `Http404`, `ValueError` from a view | 401 through `on_exception`; 404 by Ninja without `handler404`; re-raised to Django |
| an `on_exception` wrapper set on the `NinjaAPI` instance | called for the `auth=` failure and every view exception |
| Ninja `HEAD` on a `GET` operation; on `["GET", "HEAD"]` | 405; 200 |
| a Ninja view taking only the request on `/plain/{item_id}`; an async view under gunicorn, the test `Client` and uvicorn | 200, no parsing; 200 |
| Ninja 1.4.0 on Django 6.1.2; 1.4.5, 1.5.0, 1.5.3 | the URLconf import failed ("Converter 'uuid' is already registered"); every Ninja row passed |

The review of this ADR ran more probes on Django 6.1.2, DRF 3.18.3 and Ninja 1.7.3 under gunicorn 26.2.0, `runserver` and the test `Client`:

| Case | Result |
|---|---|---|
| a DRF `APIView` returning a plain `HttpResponse`, the app's default renderers | the reply carried `Allow: GET, HEAD, OPTIONS` and `Vary: Accept` |
| an inner middleware sets `request.user`; the view returns no authenticator | the view read DRF's `UNAUTHENTICATED_USER` |
| a Ninja view taking only the request on a path with a placeholder | a `UserWarning` at URLconf import |
| a chunked `POST` without `Content-Length`, read from `wsgi.input` | gunicorn: the body, with `wsgi.input_terminated` set; `runserver`: empty, no such key |
| Django's `LoginRequiredMiddleware`, a bearer caller without a session | DRF view: 200 (`login_required = False` from `as_view()`); Ninja view: 302 to the login page |
| `NinjaAPI(auth=deny)`, an operation without `auth`; one with `auth=None` | 401; 200 |
| an absolute-form target `GET http://x/v1/tasks/7` | gunicorn: `RAW_URI` with `http://x`, routed to the view; `runserver`: Django's 404 |

## Consequences

- App input rules ([ADR 0028](0028-app-input-rules.md)): Django REST Framework and Ninja (1.2.0): step 8b runs after `claim_idempotency` (Ninja's `_served`, DRF's admission), with `input_rules` in `bind_<api>()` (Ninja) or `settings.SEAMPACT` (DRF); a refusal calls `abandon_claim`.
- An app keeps its middleware, URLconf, settings, DRF classes and Ninja api. On contract routes the boundary's checks and reply win.
- The app lists one middleware first and includes one URLconf per api (DRF), or calls one function per api (Ninja).
- The root URLconf's error handlers are wrapped at boot; the app's rendering stays on its own routes.
- The app's DRF defaults never apply to contract routes; per access kind, the app names its classes in `settings.SEAMPACT`.
- DRF's 403 for a missing credential, Ninja's 405 for `HEAD` and DRF's 406 never answer a contract request.
- A `DisallowedHost` 400 goes out as Django writes it.
- Under ASGI, Django spools a body before the boundary can refuse it; under WSGI, the app's `request.body` stays empty for a chunked body the boundary read.
- App tests that call a contract view directly get the api's 500; tests go through the test `Client`.
- A broken api refuses to serve, and the system check only warns, so `migrate` still runs; CI runs `manage.py seampact_check`.
- `runserver` loses the raw-path rules and refuses a chunked body without `Content-Length`; the boundary says so once at start.
- ADR 0012's target tables gain a drf and a ninja row in the lead's follow-up.

## Traceability

- FRs: FR-5, FR-14, FR-16, FR-17, FR-20, FR-21, FR-25, FR-35, FR-40, as ADR 0026; CHK-158, CHK-161, CHK-165, CHK-168; amendments A9, A36, A40, A47, A48.
- ADRs: 0003, 0007, 0009, 0011, 0012, 0016 and 0023 (the shared obligations), 0025 (version guards), 0026 (the Python core and the placement this one mirrors).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gates on the DRF and Ninja consumers.

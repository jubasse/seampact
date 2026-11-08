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

### The shared Django layer

#### Distributions

| Distribution | Module | Holds | Depends on |
|---|---|---|---|
| `seampact-django` | `seampact.django`, `.runtime` | the URLconf and settings emitters, the boundary middleware, the exception map, the system check, the boot check, the `seampact_generate` and `seampact_check` commands | `django`, `seampact-codegen==<self>`; extra `generate` |
| `seampact-drf` | `seampact.drf`, `.runtime` | the DRF generator and placement | `djangorestframework`, `seampact-django==<self>`; extra `generate` |
| `seampact-ninja` | `seampact.ninja`, `.runtime` | the Ninja generator and placement | `django-ninja`, `seampact-django==<self>`, `seampact-codegen[pydantic]==<self>`; extra `generate` |

`seampact-drf` needs neither `seampact-ninja` nor Pydantic. The app adds `"seampact.django"` to `INSTALLED_APPS` for the system check and the commands.

#### Versions

- **Python.** As ADR 0026: 3.12 and the latest.
- **Django.** 5.2 LTS and 6.x, the matrix `floor` 5.2.
- **DRF.** 3.18, the matrix `floor`. DRF 3.18.0 asks for Django 5.2 or later and declares 5.2, 6.0 and 6.1; 3.18.0 and 3.18.3 gave the same result in the spike.
- **Ninja.** 1.5.3 or later, the matrix `floor`: the first release whose metadata declares Django 6.0, so pip installs it beside Django 6 (1.4.5 runs, but its metadata stops at 5.1; 1.4.0 fails on Django 6.1, spike). The latest is 1.7.
- **Pydantic** for Ninja: ADR 0026's range.
- **Matrix.** The matrix records the tested minors of Django, DRF and Ninja. A version below the floor is refused (`config.matrix.incompatible`). A minor outside the tested ones, within a tested major, is untested: `generate` warns, or refuses under `checks.matrix: error` (ADR 0009, ADR 0011), and the boot check logs one warning. A major outside the matrix is refused at boot ("The system check and the boot check"). `allowUntested` names these frameworks by major (`django@6`, `djangorestframework@3`, `django-ninja@1`); only a 0.x framework, such as FastAPI, is named by minor. CI runs the floor and the latest.

#### Sync and async

The boundary middleware declares both `sync_capable` and `async_capable`. Django picks the mode from the middleware inside it (spike). In sync mode it drives the shared coroutines with ADR 0026's sync driver. Per-request state lives in one mutable holder that step 1 sets on the `HttpRequest`, never in module globals.

#### Settings

Each api reads its settings from `settings.SEAMPACT["<api>"]`, as DRF reads `REST_FRAMEWORK`. Hooks and handler factories are dotted paths to callables. The layer imports them at boot and calls each factory once per request with the `HttpRequest`:

```python
MIDDLEWARE = [
    "app.generated.tasks.django.TasksBoundary",
    "django.middleware.security.SecurityMiddleware",
    # the app's middleware
]

SEAMPACT = {
    "tasks": {
        "handlers": {"tasks": "app.api.tasks_endpoints"},
        "authenticate": {"bearer": "app.api.bearer_hook"},
        "public_origin": "https://api.example.com",
    },
}
```

The keys mirror ADR 0026's `bind_<api>()` arguments: `handlers`, `authenticate`, `deciders`, `scope_resolvers`, `idempotency_store`, `on_unexpected_error`, `responses`, `body_validation`, `operations` and `public_origin`; DRF adds `access` ("DRF"). Unknown keys are refused by the boot check, by name. Ninja passes the same values to `bind_<api>()` instead ("Ninja"), which registers them as the api's values; the boot check then refuses a `settings.SEAMPACT` entry for that api, since nothing reads it.

#### The boundary middleware

Codegen emits, per api, a boundary middleware class (`TasksBoundary`) in the api's `django` module. The app lists it first in `MIDDLEWARE`. It runs step 1: the request context, the raw-path match of "Routes", the media type, the bounded body read and the decoding. On the way back it runs the route-chosen check and the outgoing response check. It answers its own refusals in the api's format. Several apis list several boundaries, each accepting the others before it, as ADR 0026 "Several apis" says.

The body read:

- A declared `Content-Length` above the route's limit answers the route's 413 before reading.
- Otherwise the boundary reads `request.body`, so the app can read it again; a `request.read()` would leave `request.body` raising `RawPostDataException` (spike). It answers the route's 413 when the body, or its `gzip` or `deflate` decoding, passes the limit, as ADR 0026 counts.
- Under WSGI, a chunked request without `Content-Length` reaches Django with an empty body (spike). When the server sets `wsgi.input_terminated` (gunicorn does), the boundary reads `wsgi.input` itself, bounded by the route's limit; the app's own `request.body` stays empty there, as Django gives it.
- A server that does not set it (`runserver`, whose `wsgi.input` reads empty, review probe) gives the boundary no way to read the body. The boundary then refuses a chunked request without `Content-Length` as the client's 400, as ADR 0026 refuses a corrupt compressed body, and its start log line lists the gap.
- `DATA_UPLOAD_MAX_MEMORY_SIZE` below the api's largest body limit would make Django refuse, as a 400, a body the contract accepts. The boot check refuses it.

#### Generated modules

As ADR 0026 says for every Python target, the schema types go into the package's `schemas` module, the operation types into its `operations` module, and the contract the runtime reads (security, access, idempotency, paging, relay, cache, wire names and the unknown-key policies per operation) into its `contract` module, which `seampact-codegen` writes the same way for FastAPI, DRF and Ninja.

#### Routes

Codegen emits, per api, a `urls` module of `path()` entries. The app includes it at `""` in its root URLconf. Each placeholder uses Django's `str` converter, named `path_<attribute>` after its input attribute, so it takes one whole segment and never clashes with a view argument such as `request` or `self`. Per path depth, literal segments come before placeholders. The DRF and Ninja sections say which view each entry points to. `generate` refuses the path segments ADR 0026 "Routes" lists, with the same codes.

The boundary matches the raw target against the contract templates. The raw target is the WSGI `RAW_URI` without its query (gunicorn), or the WSGI `REQUEST_URI`, or the ASGI `raw_path` (uvicorn). `runserver` gives none: the boundary matches the decoded `path_info` and logs once at start which raw-path rules it cannot apply. The suite runs on gunicorn and uvicorn.

An absolute-form request target (RFC 9112 section 3.2.2) keeps `scheme://authority` in gunicorn's `RAW_URI`, while Django routes the path alone (review probe). The boundary strips `scheme://authority` before the match.

Django routes `path_info`, without the script name. The boundary strips the script name (`SCRIPT_NAME`) from the raw target as a raw prefix when the raw target starts with it: gunicorn's `SCRIPT_NAME`, uvicorn's `--root-path`, and Django's `FORCE_SCRIPT_NAME` under ASGI keep it in the raw target (spike). A raw target that does not start with a non-empty script name is not a contract request, under WSGI as under ASGI, as ADR 0026 treats one outside `root_path`. The script name stays outside `mount`, as ADR 0026 keeps `root_path` outside. Under WSGI, `FORCE_SCRIPT_NAME` changes only the URLs Django builds: the raw target and `path_info` keep the server's `SCRIPT_NAME`, which is the one the boundary strips (spike).

Django decodes before routing, so the raw match and the chosen route can differ, as ADR 0026 "Routes" lists. The spike gave Django's side: `/v1/tasks/%73earch` routes to the search route; `a%2Fb` routes `a/b` to no route; `7;x=1` and `%2e%2e` route `7;x=1` and `..` as values. The boundary answers these paths' `notFound` 404 before routing, as ADR 0026 does. An encoded `%3B` is data in a parameter value and reaches the route. On the way back, once routing ran, it reads `request.resolver_match`. When its view is not the generated view of the operation the raw path matched, the boundary answers that path's `notFound` 404, whatever the reply.

- **Trailing slash.** A raw path under a base path that no contract route serves exactly is the boundary's 404 before routing. So `CommonMiddleware`'s `APPEND_SLASH` redirect, which runs inside the boundary, never answers a contract request. With `catchAll: false` it may redirect to an app route (spike: `/v1/tasks` to `/v1/tasks/` under a DRF router).
- **`HEAD`** runs the path's `GET` operation; the boundary drops the body. A Django class-based view answers `HEAD` with its `get` (spike); Ninja needs it listed ("Ninja").
- **Other methods.** A method the path does not serve answers the path's `notFound` 404 from the boundary, before DRF's 405 or its `OPTIONS` metadata reply (spike). A CORS preflight (an `OPTIONS` with `Origin` and `Access-Control-Request-Method`) is left to the app's CORS middleware, which sits after the boundary; when none answers it, the DRF view answers the path's `notFound` 404, never DRF's metadata.

Django's ASGI handler serves `http` scopes only. A websocket router (Channels' `ProtocolTypeRouter`) sits outside Django, before the boundary, and a contract declares no websocket.

`mount` is the prefix the generated patterns write before each contract path. Beside the patterns, the shared route helpers write `<Api>RouteNames` and `<Api>Urls`, as ADR 0026 says; `artefacts.routeHelpers: false` leaves both out. Ninja registers the names under the `NinjaAPI`'s `urls_namespace`, so the app reverses `f"{api.urls_namespace}:{name}"`.

#### The reply path

The generated view turns the handler's result into a Django `HttpResponse` with the boundary's own JSON encoding. It never uses a DRF `Response`, a renderer, Ninja's renderer or a `JsonResponse` default. Content negotiation is not consulted. The boundary records each reply it writes, as ADR 0026 does.

#### Exceptions on contract routes

The generated exceptions of an api derive from its contract base (`TasksContractError`). The generated views render them on a contract request of their own api.

An exception raised between the boundary and the view, by the app's own middleware, becomes a reply before the boundary sees it (spike). So at boot the layer wraps the root URLconf's `handler400`, `handler403`, `handler404` and `handler500`, with Django's defaults when the app set none. Each wrapper records the exception in the request's holder, then calls the app's handler. A `got_request_exception` receiver records any other exception. The app's rendering stays on its own routes. On a contract route, the boundary reads the record and answers with the role of:

- `Http404`: `notFound`;
- `PermissionDenied`: `forbidden`;
- `RequestDataTooBig`: `payloadTooLarge`.

Each answers by ADR 0023's rule, as ADR 0026 applies it. The DRF and Ninja sections add their own exceptions.

A `DisallowedHost` names a host this deployment does not serve, so it is not a contract request: Django's 400 goes out as written, after one log line. Any other recorded reply (`BadRequest`, another `SuspiciousOperation`) is checked as written by the outgoing check. Any other exception is the api's 500: the boundary logs it and calls `onUnexpectedError`, in every `responses` mode, `DEBUG` aside.

Under `DEBUG` only, Django renders `Http404`, `BadRequest` and `SuspiciousOperation` with its technical pages and calls no handler (spike). The boundary then lets a technical page out as Django wrote it, after its log line, as ADR 0026 lets Starlette's debug page out. Any other exception under `DEBUG` gets Django's technical 500 page, without `handler500`, after the signal the receiver records (review probe): the boundary lets that page out too, after its log line and `onUnexpectedError`.

With `DEBUG_PROPAGATE_EXCEPTIONS`, Django re-raises the exception into the boundary. The boundary logs it, calls `onUnexpectedError` and re-raises it, so the propagation the app asked for happens.

A per-request URLconf (`request.urlconf`, set by an app middleware) has its own handlers, which carry no wrapper. Its replies are checked as written.

#### The outgoing response check

ADR 0026 "The outgoing response check" holds, with Django's objects:

- Django hands the whole `HttpResponse` to the boundary before any byte goes out, so the verdict comes before the head is sent.
- A `StreamingHttpResponse` keeps its status and headers; the boundary wraps its `streaming_content`, so the chunks keep the writer's pace.
- An inner middleware can change the reply (`GZipMiddleware`, `ConditionalGetMiddleware`'s ETag and 304). The boundary compares it with what it recorded, as ADR 0026 does.

A middleware before the boundary in `MIDDLEWARE` is refused at boot. A WSGI or ASGI wrapper around the application object (an error tracker's, `WhiteNoise(application)`) runs before step 1 and is not seen; the guides say so.

#### Errors raised before the boundary

Before the boundary run the server, any wrapper around the application object, and Django's own request building. Under ASGI, Django spools the whole body before the first middleware, in memory up to `FILE_UPLOAD_MAX_MEMORY_SIZE`, then on disk; a deployment bounds it at the proxy or the server, and the guides say so. Django's ASGI handler answers a header that does not decode with a 400 before any middleware runs.

#### Test doubles

`override_settings(MIDDLEWARE=...)` without the boundary, and a view called directly by `APIRequestFactory` or `RequestFactory`, reach the generated view with no boundary (spike). The generated view fails closed: without the boundary's mark for its own operation, it answers the api's 500, logs the cause and calls `onUnexpectedError`, before any input is read. App tests go through the test `Client`; the guides say so.

#### The system check and the boot check

Before any other check, the generated `GENERATED_BY` is compared with `RUNTIME_VERSION` (ADR 0025 "Version guards", G3), as ADR 0026 does.

The same check runs in three places:

- **The boundary's `__init__`**, when Django builds the handler. It imports the root URLconf first, as Django's own URL check does, then raises `ImproperlyConfigured` listing every problem. gunicorn then stops ("Worker failed to boot."), uvicorn and `runserver` exit, and the test `Client` raises at its first request (spike). The app does not serve.
- **A Django system check**, registered by the `seampact.django` app. It runs on `check`, `runserver`, `migrate` and `test`, and reports each problem as a Django `Warning` whose `id` is `seampact.<api>`, with the operation id, the name and the fix. A warning never stops a command, so `migrate` and `shell` work on a broken app, as on Laravel.
- **`python manage.py seampact_check`**, for CI. It runs the check without starting a server and exits non-zero on any problem.

`python manage.py seampact_generate` runs ADR 0026's runner, the same as `seampact generate`. It declares no system check, so the command that fixes a version mismatch still runs, as ADR 0023 steps aside for its own.

The check lists every problem at once:

- the hook problems of ADR 0016's list, read from the dotted paths or the `bind_<api>()` arguments;
- a contract operation without a handler factory, or a path pattern missing or included twice;
- an api whose patterns are in the URLconf without its boundary in `MIDDLEWARE`;
- a contract request that another pattern would take. For each operation, the check resolves `mount` followed by the contract path, with a sample value in each placeholder, against the root URLconf. The match must be the generated view of that operation. So a `re_path` catch-all before the include, a router route, and an `include()` prefix that `mount` does not name are all refused (spike), unless `frameworkRoutes` allow-lists the pattern that wins. The run-time route-chosen check covers what a sample cannot show, such as a format-suffix route that takes only `7.json` (spike);
- on DRF, a generated `urls` module under an `include()` with a prefix; on both targets, a generated pattern under `i18n_patterns()`: with the default language unprefixed, `/fr/v1/tasks/7` still routes to the contract view (spike);
- on Ninja, a prefix where the app includes `api.urls` that, plus `bind_<api>()`'s `prefix`, does not equal `mount`, found by the resolver match above. So `<Api>Urls` holds on both targets;
- an app pattern at or under one of the api's base paths that `frameworkRoutes` does not allow-list (FR-25), read from the patterns' own prefixes;
- a root URLconf whose error handlers carry no wrapper;
- the boundary not first in `MIDDLEWARE`, other seampact boundaries aside;
- `DATA_UPLOAD_MAX_MEMORY_SIZE` below the api's largest body limit;
- a `public_origin` set under relative URLs, or a missing or malformed one under absolute URLs, with ADR 0026's item; page links write it before the script name and the raw request path;
- on DRF, an `access` setting the views cannot use: an unknown access kind or DRF name, a kind no operation has, a path that does not import or names no class of DRF's matching base;
- a Django, DRF or Ninja major outside the matrix that `allowUntested` did not name at `generate`, read with `importlib.metadata`, as Laravel's boot check refuses a major other than 13. The generated code records the majors `generate` accepted.

Beside that list, the boot check logs one warning, without refusing, for a Django, DRF or Ninja minor outside the tested minors the generated code records, as `generate` warns: a minor installed after `generate` serves with a notice.

`artefacts.bootCheck: false` turns the whole check off; `{ frameworkRoutes: false }` and `{ hooks: off }` turn their parts off, as ADR 0026 says. The handler check runs whenever the boot check does.

### DRF

#### Placement

The developer writes a class per resource that implements the api's generated protocol, and a factory that builds it from the request:

```python
class TasksService:
    def __init__(self, request: HttpRequest) -> None:
        self.user = request.user

    def update_task(self, request: UpdateTaskRequest) -> UpdateTaskResult: ...


def tasks_endpoints(request: HttpRequest) -> TasksEndpoints:
    return TasksService(request)
```

```python
urlpatterns = [
    path("", include("app.generated.tasks.urls")),
    path("admin/", admin.site.urls),
]
```

Codegen emits, per api, beside the shared parts:

- **One `APIView` per contract path**, in the api's `drf` module, with one method per operation of the path. Each `path()` entry is named `seampact.<api>.<operationId>` after the path's first operation; `<Api>RouteNames` gives each operation its path's name.
- **One serializer per operation input** ("Types and validation").
- **The exception handler**, which the views return from `get_exception_handler()`.

DRF runs `initial()` first: authentication, permissions and throttles, the app's native layer. The generated method then checks the boundary's mark and the chosen route, runs steps 2 to 5, then steps 6 to 8 on the boundary's decoded tree, and calls the handler with frozen dataclasses.

The views fix what DRF would otherwise read from the app's defaults:

- `perform_content_negotiation()` returns a fixed pair, so `Accept` never answers 406;
- `renderer_classes` holds one class and `default_response_headers` is empty, so DRF adds neither `Allow` nor `Vary: Accept` to the reply (review probe);
- `parser_classes` holds one parser that hands DRF a copy of the body the boundary decoded, and `versioning_class` is `None`. The views never read `request.data`; an app class may, and DRF's CSRF check reads `request.POST`, which would answer 415 without a parser;
- `get_authenticators()`, `get_permissions()` and `get_throttles()` return the classes the app sets for the operation's access kind (`public`, `optional`, `identity`, or `signed` for an identity a signature verifies, as the PHP targets key their native layers) in `settings.SEAMPACT["<api>"]["access"]`, keyed by DRF's own names (`authentication_classes`, `permission_classes`, `throttle_classes`), and none otherwise. The app's `DEFAULT_PERMISSION_CLASSES` never applies to a contract route, so a global `IsAuthenticated` never refuses a public operation;
- `schema = None`, so DRF's schema generator skips them.

DRF 3.18's `as_view()` sets `login_required = False`, so Django's `LoginRequiredMiddleware` never redirects a contract request (review probe). The target relies on it, and a target test fails by name if a DRF minor drops it.

DRF copies the user it authenticated to the Django request, so a hook factory reads `request.user` and `request.auth`. On an access kind with no DRF authentication classes, DRF overwrites `request.user` with its `UNAUTHENTICATED_USER` (review probe), so the user Django's `AuthenticationMiddleware` set is lost. The DRF guide tells the app to name `SessionAuthentication`, or its own class, for that kind.

The view claims an idempotency key after step 6, before the handler runs. The boundary middleware settles the claim with the reply that goes out, so a reply the exception handler or the api's 500 writes settles it too: it completes the record, or abandons it after a server error, an exception that propagates into it, or a streamed reply. Under ASGI it settles and abandons the record through `sync_to_async(thread_sensitive=True)`, in the thread the sync views run in, so a store that uses the ORM works as under WSGI. A stored reply is raised as `ReplayedReplyError`, which the exception handler answers as it was stored.

DRF views are sync. An `async def` hook or handler method is refused by the boot check, naming the method and the fix, until a consumer needs it.

#### Exceptions

`get_exception_handler()` returns the generated handler, never the app's `EXCEPTION_HANDLER` (spike). It marks the transaction for rollback, as DRF's own handler does under `ATOMIC_REQUESTS`. It renders a contract exception, and answers with the role of:

- `NotAuthenticated` and `AuthenticationFailed`: `unauthenticated`, by class. DRF gives them 403 when the first authentication class sends no `WWW-Authenticate` (spike);
- the CSRF failure of `SessionAuthentication` (spike): `csrfInvalid`. `get_authenticators()` wraps `enforce_csrf` of each `SessionAuthentication` it returns, so the failure itself is tagged, not any `PermissionDenied` raised during authentication;
- any other DRF `PermissionDenied`, and Django's: `forbidden`;
- `NotFound` and Django's `Http404`: `notFound`;
- `Throttled`: `rateLimited`, with `Retry-After` from its `wait`;
- any other `APIException`: the role of its status, as ADR 0026 maps an `HTTPException`.

Any other exception is the api's 500, logged, with `onUnexpectedError` called.

#### Types and validation

The handler gets the generated input as frozen slotted dataclasses, with ADR 0026's `Field[T]` for a member both optional and nullable. The serializer validates the boundary's decoded tree after the generated type layer:

- The type layer checks every type first, with ADR 0026's conversions (whole-number floats, date-time, date, UUID, decimal and enum strings). So DRF's lax conversions, such as a `CharField` turning `5` into `"5"`, never see a wrong type.
- String fields set `trim_whitespace=False` and `allow_blank=True`, so DRF never changes a string.
- Fields are built in `get_fields()`, never declared as class attributes. A field declared as `data`, `errors` or `fields` passes at run time, since DRF's metaclass removes it from the class, but `mypy --strict` with the DRF stubs refuses it against the serializer's own attributes (spike).
- A refused input raises the generated `schemaInvalid` exception, so the 400 is rendered. Each issue carries its `{ in, pointer, rule }`, the contract rule kept per DRF error code, bounded by `MAX_RENDERED_ISSUES = 100`.

The target takes `rules` (ADR 0009):

- **`native`, the default.** A value rule becomes DRF's own field argument where DRF has one: `min_length`, `max_length` (both counted in code points, as the contract counts), `min_value`, `max_value`. Exclusive bounds, `multipleOf`, `enum`, `const` and formats stay generated validators. The DRF guide lists the differences in a few lines.
- **`seampact-consistent`.** Every value rule is a generated validator with ADR 0003's meaning.

In both modes a `pattern` is the IR's normalised pattern (ADR 0003 section 9), checked by the framework-free pattern check of `seampact-codegen`'s runtime (py-core-5), never by DRF's `RegexField`. That check runs Python's `re` on the pattern after ADR 0003 section 9's normalisation, so `$` never matches before a final newline and `\d` matches ASCII digits only, as the contract says. The same check serves `rules: seampact-consistent` on every Python target; FastAPI and Ninja keep pydantic-core's engine under `native` (ADR 0026).

#### Native docs

DRF ships no API document of its own that the target switches. Like Laravel and Symfony, it declares no `nativeDocs` artefact: the app config refuses the key by name (`config.artefacts.unknown`). `frameworkDocs: keep` is accepted; `frameworkDocs: off` is refused (`config.frameworkDocs.unsupported`), with the fix to remove the app's own schema view.

### Ninja

This section can be cut alone.

#### Placement

The developer writes the same resource class and factory as on DRF, and calls one function in the module that builds its `NinjaAPI`:

```python
api = NinjaAPI()
bind_tasks(api, prefix="/v1", handlers=TasksHandlerFactories(tasks=tasks_endpoints), authenticate={"bearer": bearer_hook})

urlpatterns = [path("", api.urls)]
```

`bind_tasks(api, ...)` builds the api's `Router` and adds it to the app's `NinjaAPI` with `add_router()`. The prefix where the app includes `api.urls`, plus `prefix`, must equal `mount`; the boot check's resolver match refuses any other sum. `bind_<api>()` also takes ADR 0026's keyword arguments (`responses`, `body_validation`, `operations`, `public_origin`), and per access kind the `auth` and `throttle` values Ninja accepts on an operation. For an access kind the app gave no values, `bind_<api>()` passes `auth=None` and `throttle=[]`, so a `NinjaAPI(auth=...)` set app-wide never refuses a public operation (review probe: 401 otherwise).

Each operation is one `api_operation()` call:

- with `["GET", "HEAD"]` for a `GET` operation, since a Ninja `GET` operation answers `HEAD` with 405 (spike);
- with `include_in_schema=False`;
- with a view that takes the request and one `str` parameter per path placeholder, which Ninja cannot refuse, so it answers no 422 (spike). The view ignores them: the input comes from the boundary's raw decoding. A view without them would make Ninja warn at URLconf import for each placeholder, and fail under `python -W error` (review probe).

Each contract path also declares `OPTIONS`, without `auth=` or throttles, with a view of the same parameters that answers the path's `notFound` 404: the boundary leaves a CORS preflight to the app, and when no CORS layer answers it, Ninja would answer 405, as DRF's `options` would answer its metadata.

`bind_<api>()` marks the Django views of the contract paths `login_required = False`, so Django's `LoginRequiredMiddleware` never redirects a contract request; it would answer a bearer caller without a session with a 302 (review probe). A target test fails by name if the mark stops reaching Ninja's views.

`bind_<api>()` takes Ninja's per-access-kind values as `access`, a mapping from each access kind to `AccessSettings(auth=..., throttle=...)`: the `auth=` and `throttle=` Ninja applies to that kind's operations, none when the kind is absent.

Ninja runs `auth=` and throttles first. The generated view then checks the boundary's mark and the chosen route, runs steps 2 to 5, then validates the decoded tree with the shared Pydantic models of ADR 0026 "Types and validation" (strict mode, the same type layer, the same `rules`).

The target option `views` is `sync`, the default, or `async`. Async views run natively under ASGI and through Django's adapter under WSGI (spike). In sync views an `async def` hook or handler method is refused by the boot check, as on DRF. In async views a `def` method runs through Django's `sync_to_async`.

#### Exceptions

The generated view answers the api's own exceptions itself (a contract refusal, a raised contract exception, a replayed idempotent reply, a failure of the boundary), so no handler the app adds to its `NinjaAPI` takes them. `bind_<api>()` wraps the app's `NinjaAPI.on_exception`, which Ninja calls for every exception it handles, `auth=` failures included (spike). The wrapper records the exception, then calls the app's. `on_exception` is not in Ninja's guide, so a test of the target fails by name if a minor stops calling it, and the boot check refuses an `on_exception` replaced after `bind_<api>()`.

On a contract route the boundary answers with the role of:

- `AuthenticationError`: `unauthenticated`;
- `AuthorizationError`: `forbidden`;
- `Throttled`: `rateLimited`, keeping `Retry-After`;
- `Http404`: `notFound`, which Ninja renders itself without calling `handler404` (spike);
- any other `HttpError`: the role of its status.

Ninja re-raises any other exception to Django outside `DEBUG` (spike), and Django would log its message on `django.request`. On a request a boundary matched, outside `DEBUG` and `DEBUG_PROPAGATE_EXCEPTIONS`, the wrapper answers such an exception with a bare 500 instead, which the boundary replaces with the api's 500, logging the class and the place only, as on DRF. A `BadRequest` or `SuspiciousOperation` still goes to Django.

#### The boot check

Beside the shared list, the check reads the values `bind_<api>()` took: a `responses` mode other than `strict` or `warn`, an `operations` value that is not an `OperationSettings`, and a `body_validation` that is not a bool are refused by name. So are an `auth=` or a throttle on an access kind with an operation that declares no reply for its refusal (`unauthenticated` or a single 401 code, `rateLimited` or a single 429 code), since Ninja's refusal would become the api's 500. A second `bind_<api>()` on the same `NinjaAPI` raises. Ninja's own docs routes, read from the `NinjaAPI`'s `docs_url` and `openapi_url` under its prefix, are framework routes, accepted and listed in the report (ADR 0011).

#### Native docs

Contract operations are always registered with `include_in_schema=False`, so Ninja builds no schema of its own for them. With the `nativeDocs` artefact, `bind_<api>()` wraps `NinjaAPI.get_openapi_schema()` so each document it builds holds the api's operations with seampact's operation objects at their paths under the entry's `mount`, and seampact's components beside the app's; a component the app's document holds with another value fails the boot, naming it. The generated `native_docs.json` and its reader are the ones FastAPI uses (ADR 0026 "Native docs"). `frameworkDocs: keep` is accepted; `frameworkDocs: off` is refused (`config.frameworkDocs.unsupported`), with the fix `NinjaAPI(docs_url=None, openapi_url=None)`.

### Redaction

ADR 0026 "Redaction" holds: dataclasses get a generated `__repr__` and `__rich_repr__`, Pydantic models a generated `__repr_args__`. On DRF, a signed route's input prints its body `[redacted]`, and a handler's request its principal and scopes; a serializer prints none of the data it validates, and a validation error carries a fixed message per rule, never the refused value. The boundary's logs go to the `seampact.<api>` logger.

### Options and registration

The target options are ADR 0026's: `handlers` (`perResource` only), `indent`, `rules`, `responses`, `bodyValidation`, `frameworkEtag` and `catchAll`, with unknown keys refused by name. Ninja adds `views`. The naming options and `layout` are refused as ADR 0026 refuses them. An operation's value wins over the api's, which wins over the target option.

### What the shape-imposing features turn off with

The targets impose no wire shape ([A36](../decisions.md#a36)):

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| DRF's or Pydantic's own value rules | native | `rules: seampact-consistent` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native`, refused by name until a consumer needs it |
| the boot check | on | `artefacts.bootCheck`, or `{ frameworkRoutes, hooks }` |

### Links and the client

The targets consume no link and generate no client, as ADR 0026 says (`link.kind.not-consumed`).

### What the generated code depends on

At run time: Python 3.12 or later; Django 5.2 or 6.x; DRF 3.18 for DRF; Ninja 1.5.3 or later and Pydantic for Ninja; `seampact-hooks`, `seampact-codegen`, `seampact-django` and the target's distribution. The boundary runtime is imported, not copied (ADR 0025). Generated files pass `ruff check`, `ruff format --check` and `mypy --strict` with `django-stubs` (and `djangorestframework-stubs` on DRF), on Python 3.12 and the latest, and Django 5.2 and 6.x; the Ninja golden also passes `pyright` strict.

### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the targets do not serve ([A47](../decisions.md#a47)), as ADR 0026 lists them.

| Waits for | What |
|---|---|
| a consumer that needs them | ADR 0026's list; `async def` hooks and handlers on DRF and in Ninja's sync views |
| after 1.0 | Django, DRF and Ninja versions below the floor (refused, not waiting); `hooks: vendored` ([A40](../decisions.md#a40)); principal bindings, refused by name as on PHP |

### The consumer and the proof

The sample apps live in `scripts/consumers/targets/drf/` and `scripts/consumers/targets/ninja/`, shaped as ADR 0026's: the handlers, the hook doubles, the three control routes, and the state in one file, since gunicorn and uvicorn run several workers. Each installs the seampact wheels `uv build` writes and the reference contract's bundle.

`p7-drf.yml` has, beside `changes` and the `packages` tests:

- `e2e`, two rows on `ubuntu-24.04` with `actions/setup-python`: {Python 3.12, Django 5.2, DRF 3.18 floor, gunicorn WSGI} and {the latest Python, the latest Django 6.x, the latest DRF, uvicorn ASGI}. Node is removed, the app is installed with pip only and generated, then Node comes back for the suite alone, as ADR 0026 says. It runs the `default`, `hand-written` and `boot` profiles (ADR 0015 "Suite profiles") over every operation of both apis, from drf-3; a boot imports the WSGI or ASGI module of a misconfigured variant, whose handler runs the boot check;
- `drf`, the aggregate.

`p7-ninja.yml` has the same jobs, with rows {Python 3.12, Django 5.2, the Ninja floor, gunicorn, `views: sync`} and {the latest Python, the latest Django 6.x, the latest Ninja, uvicorn, `views: async`}, every profile, and the aggregate `ninja`.

The proof is the `node`-absent step, a green suite row per row above, each target's `test_redaction.py`, and the suite's security rows. The suite runs every case of the reference contract.

### Delivery

| PR | Delivers |
|---|---|
| drf-1 | `python/django` emitters (URLconf, settings, app config) and `python/drf`: the generator, dataclass inputs, serializers, `APIView` declarations, exceptions; a golden under ruff and `mypy --strict` with the stubs, on Django 5.2 and 6.x |
| drf-2 | the boundary middleware (sync and async), the `APIView` steps 2 to 8, the exception map and the handler wrappers, the system check, the boot check, `seampact_generate` and `seampact_check`; the sample app, the `default`, `hand-written` and `boot` profiles, the e2e job of `p7-drf.yml` |
| drf-3 | paging, idempotency, throttle beside DRF's throttles, cache headers, the signed raw body, deadlines, relays, redaction; the suite over every operation of both apis with nothing refused, and `test_redaction.py` |
| drf-4 | DRF authentication, permission and throttle classes per access kind, the role map of DRF's exceptions, session and CSRF beside the boundary, absolute URLs, CORS preflights left to the app; the suite's security rows and a token-auth row in the consumer. Principal bindings stay refused by name, as on PHP, until after 1.0 |
| ninja-1 | `python/ninja`: the generator on the shared Pydantic emitter, `Router` declarations, views, `bind_<api>()`; a golden under ruff, `mypy --strict` and `pyright` strict |
| ninja-2 | the Ninja placement on `seampact-django`, the `on_exception` wrapper, sync and async views; the sample app, every profile, `p7-ninja.yml` |

## Spike

Run on CPython 3.12.16 with gunicorn 26.2.0 and uvicorn 0.54.0, and not kept, in three environments: Django 5.2.18 with DRF 3.18.0 and Ninja 1.4.0; Django 6.1.2 with DRF 3.18.3 and Ninja 1.7.3; Django 6.1.2 with DRF 3.18.0 and Ninja 1.4.0, then 1.4.5, 1.5.0 and 1.5.3. Pydantic 2.14.2 throughout. A reduced app had a recording boundary first in `MIDDLEWARE`, Django's usual middleware, an inner middleware that raised on demand, recording root URLconf handlers, DRF views with recording authentication, permission and throttle classes, and a Ninja api. Requests went through the test `Client`, and through raw sockets to gunicorn, uvicorn and `runserver`. Every row gave the same result in every environment, except the Ninja 1.4.0 row.

| Case | Result |
|---|---|
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
|---|---|
| a DRF `APIView` returning a plain `HttpResponse`, the app's default renderers | the reply carried `Allow: GET, HEAD, OPTIONS` and `Vary: Accept` |
| an inner middleware sets `request.user`; the view returns no authenticator | the view read DRF's `UNAUTHENTICATED_USER` |
| a Ninja view taking only the request on a path with a placeholder | a `UserWarning` at URLconf import |
| a chunked `POST` without `Content-Length`, read from `wsgi.input` | gunicorn: the body, with `wsgi.input_terminated` set; `runserver`: empty, no such key |
| Django's `LoginRequiredMiddleware`, a bearer caller without a session | DRF view: 200 (`login_required = False` from `as_view()`); Ninja view: 302 to the login page |
| `NinjaAPI(auth=deny)`, an operation without `auth`; one with `auth=None` | 401; 200 |
| an absolute-form target `GET http://x/v1/tasks/7` | gunicorn: `RAW_URI` with `http://x`, routed to the view; `runserver`: Django's 404 |

## Consequences

- App input rules ([ADR 0028](0028-app-input-rules.md)): Django REST Framework and Ninja (1.1.x): step 8b runs after `claim_idempotency` (Ninja's `_served`, DRF's admission), with `input_rules` in `bind_<api>()` (Ninja) or `settings.SEAMPACT` (DRF); a refusal calls `abandon_claim`.
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

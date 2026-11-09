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

# ADR 0026: The Python core and the FastAPI target

Status: accepted

## Context

[A48](../decisions.md#a48) puts the Python targets in v1: FastAPI, Django REST Framework and Django Ninja, on a shared Python core. ADR 0012 fixes what every server target generates around the developer's handlers. ADR 0016 fixes the rules a target meets: the check order, a reply written by the boundary, exceptions handled narrowly, the outgoing response check, the body limit and the boot check. ADR 0010 "Amendment 2026-11-01: the Python channels" fixes how a Python build gets the binary.

This ADR states two things. First, the Python core: the distributions, the versions, sync and async code, the hook protocols, and what the PHP core gave it. ADR 0027 builds the Django targets on the same core. Second, the FastAPI target: `seampact-fastapi` generates, per api of the app config, Python that places the checks around the developer's handlers in a FastAPI app. `seampact generate` runs it with pip only, and the app builds on a machine without Node ([A9](../decisions.md#a9)). What this ADR does not restate holds as ADR 0016 and ADR 0023 say.

Seven FastAPI and Starlette behaviours shape the placement (spike):

- Starlette builds its middleware stack once, at the first ASGI call: `ServerErrorMiddleware`, then the app's `user_middleware`, then `ExceptionMiddleware`, then the router. `add_middleware` inserts at the front of `user_middleware`, so the last one added is the outermost. Adding one after start raises.
- Dependencies run in a fixed order: the app's global dependencies, the router's, the route's `dependencies`, then the endpoint's parameters in signature order. A `def` dependency runs in the threadpool. A parameter error does not stop the others: FastAPI resolves every sibling, skips only a dependency whose own sub-dependency failed, and answers 422 before the endpoint. FastAPI caches a dependency per request, and `app.dependency_overrides` replaces any dependency in the tree.
- `ExceptionMiddleware` renders an `HTTPException` inside the stack. An outer middleware sees the reply, never the exception. Any other exception crosses the user middleware on its way to `ServerErrorMiddleware`.
- Starlette decodes the path before routing (`scope["path"]`) and keeps the raw one (`scope["raw_path"]`). Its router redirects a path with a trailing slash (307, `redirect_slashes`).
- FastAPI parses and validates the parameters an endpoint declares, in Pydantic's lax mode, and answers 422. An endpoint that declares none gets no parsing.
- The server sends `lifespan.startup` before the first request. uvicorn exits when the app answers `lifespan.startup.failed`. `TestClient` runs the lifespan only inside `with`.
- Pydantic's strict mode refuses `1.0` for an `int`, and, on Python objects, a string for a `datetime`, a `date`, a `UUID`, a `Decimal` or an enum.

## Options

- Python core: a port of the PHP core, or a core designed for Python. Choice: designed for Python, keeping only the PHP ideas that fit ("From the PHP core" below).
- Step 1 and the outgoing check: Starlette's `BaseHTTPMiddleware`, a custom `APIRoute` class, or a pure ASGI middleware placed outermost. Choice: the pure ASGI middleware. It sees the raw path before routing, every message of every reply, streams at their own pace, and every exception the app does not handle. `BaseHTTPMiddleware` hands over a rebuilt `Response`, and a route class runs after routing.
- Steps 2 to 5: in the boundary middleware, or in a route dependency. Choice: the route dependency. FastAPI resolves it after the app's global and router dependencies, so a hook can reuse what they resolved (a database session, a `Security` scheme) from FastAPI's per-request cache. It runs after them, not only once they passed: FastAPI keeps resolving after a parameter error and answers 422 at the end ("Placement").
- Step 6: FastAPI's own parameter parsing, or Pydantic on the boundary's decoded tree. Choice: the decoded tree. FastAPI's parsing is lax (`"5"` becomes `5`), answers 422, and never sees the raw body the boundary bounded and decoded.
- Handlers: decorated functions, or a `typing.Protocol` per resource implemented by a class the app builds in a FastAPI dependency. Choice: the protocol. The generated route keeps its own signature, so FastAPI parses nothing, and `Depends` and `dependency_overrides` still reach the handler's own dependencies (spike).
- Boot check: when `bind_<api>()` runs, on the first request, or on `lifespan.startup`. Choice: on `lifespan.startup`, after the app's own startup code, with a first-request fallback for a server or test client that runs no lifespan. At bind time the app may still add routes and middleware.

## Decisions

### Python core

#### Distributions

Every package is a PEP 420 `seampact.*` namespace distribution in the uv workspace `python/`, with `python/uv.lock` committed and used with `--locked`. No distribution ships `seampact/__init__.py`.

| Distribution | Module | Holds | Depends on |
|---|---|---|---|
| `seampact-ir` | `seampact.ir` | the IR model, naming, the reader, the bundle, the binary, the app config, the entry view, the channels, the writer, the `seampact` console script, the `Generator` protocol, the matrix copy | `ruamel.yaml`, `jsonschema`; extra `compiler` |
| `seampact-hooks` | `seampact.hooks` | hook protocols, decision and subject types, `Field`, store and redaction protocols | nothing |
| `seampact-signed-webhooks` | `seampact.signed_webhooks` | ADR 0013's five steps | nothing |
| `seampact-codegen` | `seampact.codegen`, `.runtime`, `.runtime.pydantic` | the neutral emitters and the framework-free runtime | `seampact-hooks`; extras `pydantic` and `generate` (`seampact-ir`) |
| `seampact-fastapi` | `seampact.fastapi`, `.runtime` | the FastAPI generator and placement | `fastapi`, `seampact-codegen[pydantic]==<self>`; extra `generate` |
| `seampact-django`, `seampact-drf`, `seampact-ninja` | | ADR 0027 | |

`==<self>` is the exact version the release pipeline stamps (ADR 0025 "Version guards", G1). The generator and the runtime of a framework ship in one distribution (ADR 0025 option D), so G2 holds by construction, as in PHP. The generator's own dependencies sit behind the `generate` extra: an app runs `pip install seampact-fastapi` for production and `pip install "seampact-fastapi[generate]"` as a dev dependency. uv, Poetry and pip-tools read the same metadata.

The core holds everything framework-free: getting the IR, the runner, the hooks, the neutral codegen plan, and the runtime of step 1's decoding, steps 2 to 5, field rights, idempotency, cache headers, paging, replies and the outgoing verdict. A framework distribution holds only its placement: where the steps run, how it reads the request and writes the reply, its exception map and its boot check.

The runner finds targets through the entry point group `seampact.generators`, read with `importlib.metadata`. Each target implements the `Generator` protocol.

#### The binary and the root project

ADR 0010 "Amendment 2026-11-01: the Python channels" holds. The `seampact-compiler` wheel puts the binary at `seampact/compiler/bin/<asset>`. Only the `pyproject.toml` of the project directory sets an override. A `[tool.seampact.binary]` table in a uv workspace member, or in a locally installed project (read from its `direct_url.json`), is refused (`binary.override-not-root`, naming the file). A project without a `pyproject.toml` has no override: a pip-only project is legitimate, unlike a Composer project without `composer.json`.

#### Versions

- **Python.** 3.12 is the floor of every distribution; CI runs 3.12 and the latest Python. 3.10 reached its end of life in October 2026, and Django 6 needs 3.12.
- **FastAPI.** 0.162, the latest minor today, is the matrix `floor`. FastAPI breaks in minors, so the matrix records it per minor, and CI runs the floor and the latest. An older minor is refused (`config.matrix.incompatible`); a newer one is untested (ADR 0009). `allowUntested` names a 0.x framework by its minor (`fastapi@0.163`), since 0.x minors break.
- **Starlette.** Through FastAPI's own range: FastAPI 0.162 asks for `starlette>=0.46.0`. The spike ran 0.46.0 and 1.10.0.
- **Pydantic.** 2.9 or later, FastAPI 0.162's own floor. Pydantic 1 is refused (`config.matrix.incompatible`). The generated models never use the `pydantic.v1` shim.
- **Distributions and locks.** A distribution declares a range from its floor for the framework it serves, and the exact `==<self>` for the seampact distributions it needs (G1). The workspace lock and the CI rows pin every package exactly, with hashes.

#### Sync and async

The shared runtime writes each step once, as a coroutine. FastAPI awaits them. A sync placement (ADR 0027) drives them with a driver that refuses a suspension as the boundary's 500.

A hook or handler method may be a plain `def` or an `async def`. The runtime awaits an `async def` method on the event loop. It runs a `def` method with Starlette's `run_in_threadpool`, which carries the caller's context variables (spike), and awaits an awaitable that a `def` returns. The threadpool is anyio's default limiter (40 threads), shared with FastAPI's own `def` dependencies; the FastAPI guide says so.

The runtime keeps per-request state in the ASGI scope, in one mutable holder under a seampact key that step 1 puts there, never in module globals: a long-lived worker serves many requests at once, and an inner middleware that copies the scope keeps the same holder.

#### Hook protocols

`seampact-hooks` reads the shared hooks shape manifest (`fixtures/hooks-shape/shape.json`), as the npm, Java and PHP hooks packages do:

- `AuthenticateHook`, `DecideHook`, `ResolveScopeHook` and `IdempotencyStore` are `typing.Protocol` classes. Each method returns `T | Awaitable[T]`, so a `def` and an `async def` both satisfy it.
- Values are frozen slotted dataclasses. A union's arms live in the union's module (`seampact.hooks.decision.Allowed`).
- Manifest members in camel case read as snake case. An optional member defaults to `None`; a nullable one is `T | None` without a default.
- `Field[T]` is `T | Literal[Absent.ABSENT]`, with `Absent` a one-member enum, so an absent member and an explicit `None` stay apart (CHK-158).
- `seampact-hooks` has no dependency, so an app can vendor it.

The per-api `UnexpectedErrorListener` protocol (`TasksUnexpectedErrorListener`) is generated in the api's `fastapi` module and extends the runtime's; `bind_<api>()` takes its factory, so each api's listener hears only that api's failures.

Each identity an operation reads gets a frozen credentials class in the `operations` module (`UserCredentials`), one `str | None` attribute per scheme, hidden from `repr`. The authenticate hook receives an instance in `credentials`, as the Node and PHP targets give theirs.

#### Naming

Python names follow ADR 0007 sections 4 and 5: types in Pascal case, attributes, functions and members in snake case, enum members in upper snake case, a reserved word escaped with a trailing `_`, and a member whose name starts with a digit prefixed with `field_`. The generated models set Pydantic's `protected_namespaces=()`. Generated code imports framework names qualified or under private aliases, never a bare `BaseModel` or `Field` beside contract names.

#### From the PHP core

| PHP choice | Here | How |
|---|---|---|
| package split `ir`, `hooks`, `codegen`, one per framework | adapted | PEP 420 namespace distributions, plus `seampact-django` for the Django layer (ADR 0027) |
| generator and runtime in one framework package | kept | the generator's dependencies move to a `generate` extra |
| read-only mirror repositories and the split job | dropped | PyPI publishes from the monorepo; tests install from wheels `uv build` writes |
| binary fetched by a download | adapted | `seampact-compiler` platform wheels; pin, hash, cache and platform refusals stay |
| `extra.seampact.generator` discovery | adapted | entry point group `seampact.generators` |
| `extra.seampact.binary` in the root `composer.json` | adapted | `[tool.seampact.binary]` in the root `pyproject.toml` |
| PSR-4 check on `outDir` | adapted | `outDir` must be an importable package path of the project (`config.python.module-path-missing`); the default stays `__generated__` ([A41](../decisions.md#a41)) |
| `nette/php-generator` printer | dropped | an own deterministic line printer, its golden checked by `ruff format --check`, never `ast.unparse` |
| hooks shape manifest and `Field` | kept | `typing.Protocol`, frozen slotted dataclasses, `Field` with the `Absent` sentinel |
| hooks as container bindings or tagged services | dropped | FastAPI: factories that are FastAPI dependencies; Django: dotted paths in `settings.SEAMPACT` |
| boot check in `booted()` or a compiler pass | dropped | FastAPI: `lifespan.startup` in the boundary; Django: a system check and the middleware's `__init__` |
| first-request "boundary first" assertion | kept | for a server or test client that runs no lifespan |
| boundary first, raw-path match, route-chosen comparison | kept | Starlette and Django decode the path before routing, as Laravel and Symfony do |
| FormRequest rules and Validator constraints | dropped | Pydantic in strict mode (FastAPI, Ninja), DRF serializers (DRF); the split between a generated type layer and native value rules stays |
| `rules: native` or `seampact-consistent` | kept | `native` is the default |
| exception map by class, then by status | kept | Starlette `HTTPException` here; Django and DRF exceptions in ADR 0027 |
| per-api identity classes (ADR 0025) | kept | a per-api contract exception base |
| settings through `env()` | adapted | FastAPI: keyword arguments of `bind_<api>()`, values from the app's own settings; Django: `settings.SEAMPACT["<api>"]` |
| Octane and worker-mode refusals | dropped | long-lived ASGI workers are the norm; state lives in the request scope |
| redaction by `__debugInfo()` and a VarDumper caster | adapted | `__repr__` and `__rich_repr__` print `[redacted]` |
| `php -S` for the consumers | dropped | uvicorn, and gunicorn for Django |
| PHPStan max on the golden | adapted | `mypy --strict` and `pyright` strict |

### Placement

The developer writes a class per resource that implements the api's generated protocol (ADR 0007 `handlers: perResource`, `TasksEndpoints`), and a factory that builds it. The factory is a FastAPI dependency, so it takes the app's own dependencies:

```python
class TasksService:
    def __init__(self, db: Session) -> None:
        self.db = db

    async def update_task(self, request: UpdateTaskRequest) -> UpdateTaskResult: ...


def tasks_endpoints(db: Session = Depends(get_db)) -> TasksEndpoints:
    return TasksService(db)


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=settings.origins)
bind_tasks(app, handlers=TasksHandlerFactories(tasks=tasks_endpoints), authenticate={"bearer": bearer_hook})
```

Each method takes the operation's generated request (`UpdateTaskRequest`). It holds:

- `input`, the typed input: the path, query and header parameters and the body; the credential and CSRF headers stay the boundary's;
- who is calling (ADR 0012 "Open tenancy"), read from the boundary's request state, never from the wire: `principal` on a route with an identity, the generated `<Identity>Principal` (`None` for an anonymous caller on an optional-auth route), and `scopes` on a scoped route, one attribute per scope holding its `ResolvedScope`.

Its `repr` prints `principal` and `scopes` as `[redacted]`.

Codegen emits, per api, a package under the target entry's `out`:

- **Per operation**: the request, the input model and its parts, the result classes and one exception class per code. `bind_<api>()` hands the runtime each operation's request, success and errors classes (`OperationTypes`) with one `add_operation` call per route.
- **The boundary middleware** (`TasksBoundary`), a pure ASGI middleware. It runs step 1: the request context, the raw-path match of "Routes", the media type, the bounded body read and the decoding. It runs the outgoing response check, the boot check on `lifespan.startup`, and the first-request fallback. It answers its own refusals in the api's format.
- **The access dependency**, in each contract route's `dependencies`. It runs steps 2 to 5: authenticate, principal requirements, scopes and requirements. It first checks that the route FastAPI's router chose (`scope["route"]`) carries the operation the raw path matched. Once steps 2 to 5 admit the request, it marks the request scope with the operation id. Its hook factories are its sub-dependencies, so they run before that check and before step 2: they are the app's native layer, and a refusal one raises (a `Security` scheme's 401 or 403) answers as "Exceptions on contract routes" says.
- **The input dependency**, an endpoint parameter that takes the access dependency as a sub-dependency (FastAPI resolves that once per request). It runs steps 6 to 8 on the boundary's decoded tree, builds the typed input and marks the request scope with it. Without the access mark for its own operation, it fails closed: the api's 500 and `onUnexpectedError`, before any input is read.
- **The endpoint**, one per operation. It takes only the `Request`, the input dependency and the handler factory, in that order, so the input is checked before the factory opens a session. Without the input mark for its own operation, it fails closed as the input dependency does. It calls the handler method and writes its result.
- **`bind_tasks(target, ...)`**, the one call the app makes, last, after its own middleware and exception handlers. `target` is the app, or an `APIRouter` of the app's choosing. It builds the api's `APIRouter` with the app's factories as dependencies and includes it into `target` with no prefix, registers the exception handlers, wraps the app's `HTTPException` handler ("Exceptions on contract routes"), and adds the boundary with `add_middleware`, so it is the outermost of `app.user_middleware`.

`bind_<api>()` builds the router itself, rather than leaving `include_router` to the app: FastAPI fixes a route's dependency tree when the route is added, and the factories are known only when the app calls `bind_<api>()`. An override in `app.dependency_overrides` would also be lost to an app test's `dependency_overrides.clear()`. The routes stay the framework's: generated code declares them, and the app chooses the router tree they join. When `target` is an `APIRouter`, the app also passes itself (`app=`), since the boundary and the exception handlers belong to the app, and calls `bind_<api>()` before it includes that router. FastAPI 0.162 does not copy an included router's routes: `include_router` keeps a reference, and a route added later is served too. The order is still the rule, so the boot check finds the routes where "The boot check" looks for them.

The schema types go into the package's `schemas` module, the operation types into its `operations` module (on every Python target, since the generator cannot know the import path of the package's root), the contract the runtime reads into its `contract` module, which every Python target writes alike, and the FastAPI placement into its `fastapi` module. A declared schema and a placement class never share a module; a name taken twice in a module is refused as `name.collision`. No runtime is generated: the code imports it from the installed distributions (ADR 0025).

The handler returns the operation's generated result: a union of one frozen class per declared success status and the typed error result (ADR 0007 `errors` role). It may instead raise one of the generated exceptions. Any other exception from a hook is a 500 with `onUnexpectedError` called (ADR 0012 "Failures inside hooks").

### Routes

Each operation is one `add_api_route` call with Starlette's path syntax, each placeholder named after its input attribute (`/v1/tasks/{task_id}`), so `request.path_params` and `url_path_for` work by name. Contract routes carry no convertor: a placeholder takes one whole segment. Per path depth, literal segments are registered before placeholders: `/v1/tasks/search` before `/v1/tasks/{task_id}`. Each route is named `seampact.<api>.<operationId>`. `generate` refuses by name, as on Laravel:

- a static segment holding `{`, `}` or `?` (`path.segment.literal.unsupported`);
- a static segment a client sends percent-encoded (`path.segment.encoded.unsupported`);
- a segment that mixes a placeholder with literal text (`path.segment.mixed.unsupported`).

The boundary matches the raw request target against the contract templates. The raw target is the ASGI `raw_path`, which uvicorn, hypercorn and `TestClient` all give as sent, without the query (spike). An absolute-form target (RFC 9112 section 3.2.2, `GET http://host/v1/health HTTP/1.1`) keeps `http://host` in both uvicorn's `raw_path` and its `path`, and Starlette routes that `path` to no route (probe, uvicorn 0.54 on h11). The boundary strips `scheme://authority` before the match, as ADR 0027 does, and hands the app the stripped `path` and `raw_path`, so the request reaches the contract route. The ASGI specification makes `raw_path` optional: under a server that gives none, the boundary matches the decoded `path` and logs once at start which raw-path rules it cannot apply. The suite runs only on uvicorn.

Starlette decodes the path before routing, so the raw match and the chosen route can differ, as on Laravel ("Routes" of ADR 0023):

- `/v1/tasks/%73earch` reaches the search route while the raw path matches `{task_id}` (spike). The access dependency answers the path's `notFound` 404 before any check.
- A raw path under one of the api's base paths that no contract route serves exactly answers the api's `notFound` 404 from the boundary, before routing: a trailing slash (which Starlette would redirect with a 307, spike), `//`, a dot segment (`%2e%2e`, which Starlette decodes to `..` and routes as a value), a percent-encoded static segment, and a path parameter holding a raw `;` (`7;x=1`). An encoded `%3B` is data in a parameter value: `7%3Bx=1` matches, its value `7;x=1`. A raw path whose base path is itself encoded (`/%761/health`) is under no base path, but its decoded form is a contract path that Starlette would route: the boundary answers the api's `notFound` 404 for it too.
- `a%2Fb` in a segment matches `{task_id}` raw, but Starlette routes the decoded `a/b`. On the way back, once routing ran, the boundary reads the route FastAPI's router chose. When it is not the contract route of the operation the raw path matched (no route, an app route, a mounted sub-app or another contract route), the boundary answers that path's `notFound` 404, whatever the reply.
- `catchAll: false` leaves those paths to the app.
- The boundary acts on `http` scopes only. A `websocket` or `lifespan` scope passes through untouched, since a contract declares no websocket. An app `WebSocketRoute` under a base path is an app route like any other: the boot check refuses it unless `frameworkRoutes` lists it.

Each `GET` operation is registered with `methods=["GET", "HEAD"]`, since a FastAPI `APIRoute` registered for `GET` answers `HEAD` with 405 (review probe). `HEAD` runs the path's `GET` operation; the boundary drops the body. A method the path does not serve answers the path's `notFound` 404 from the boundary, where Starlette would answer 405. A CORS preflight (`OPTIONS` with `Origin` and `Access-Control-Request-Method`) passes the boundary untouched and is left to the app's `CORSMiddleware`, as on the PHP targets. The boot check refuses a `CORSMiddleware` outside the boundary, so the app adds it before `bind_<api>()`.

`mount` is the prefix the generated router writes before each contract path; `bind_<api>()` includes the router with no prefix, and neither the target router nor the routers it joins may add one: the boot check refuses a prefix and points to `mount`. An ASGI `root_path` (an app mounted by another ASGI app, or `--root-path`) stays outside the mount, as a servlet context path does. Servers differ: `TestClient` leaves it out of `path` and `raw_path`, a parent `Mount` and uvicorn's `--root-path` keep it in both (review probe). So when `raw_path` starts with `root_path`, the boundary strips that raw prefix before the match, as ADR 0023 strips the front controller's base path; a `raw_path` that does not start with a non-empty `root_path` is not a contract request.

Beside the routes, the shared route helpers of `seampact-codegen` write `<Api>RouteNames` and `<Api>Urls`, as ADR 0023 "Routes" describes them; `artefacts.routeHelpers: false` leaves both out.

### The reply path

The endpoint turns the handler's result into a Starlette `Response` whose status, headers and body the boundary writes, with its own JSON encoding. It never uses a `response_model`, FastAPI's `jsonable_encoder` or a `JSONResponse` default. Content negotiation is not consulted. The boundary records each reply it writes (status, headers, a digest of the body) in the request scope, so the outgoing check can tell it from a reply the app wrote.

### Exceptions on contract routes

The generated exceptions of an api derive from its contract base (`TasksContractError`). `bind_<api>()` registers one handler for that base with `add_exception_handler`. It renders the code on a contract request of its own api. Elsewhere it re-raises, so the app's own error handling applies.

An `HTTPException` is rendered inside Starlette's stack, so the boundary sees only the reply (spike). Starlette picks a handler by status code first, then by the nearest class of the exception. `bind_<api>()` therefore wraps every entry of `app.exception_handlers` that can take an `HTTPException`: a key that is Starlette's `HTTPException`, FastAPI's, or a subclass of either, and every integer status key, with FastAPI's default handler kept when the app set none. Each wrapper records the exception in the request scope and then calls the app's handler. The app's rendering stays on its own routes. An app handler for `fastapi.HTTPException` or for `401` took the exception before a wrapper on Starlette's class alone saw it (review probe), hence every entry. On a contract route, the boundary reads the record and answers with the role of the status:

- 401: `unauthenticated`, as FastAPI's `OAuth2PasswordBearer` and `HTTPBearer` raise it;
- 403: `forbidden`;
- 404: `notFound`;
- 413: `payloadTooLarge`;
- 429: `rateLimited`, keeping `Retry-After`;
- 503: `serviceUnavailable`, keeping `Retry-After`.

Each answers by ADR 0023's rule: the code of its role when the operation declares one; else the operation's single code of that status; with the params its role binding renders, or none when the code requires none; else the api's 500, logged. An access hook that raises an `HTTPException` keeps its role. Any other reply the boundary did not write, a `RequestValidationError` 422 of an app dependency included, is checked as written by the outgoing check.

Any other exception crosses the boundary (spike): it answers the api's 500, logs it and calls `onUnexpectedError`, in every `responses` mode. Under `app.debug` only, it sends nothing and re-raises after its log line, so Starlette's debug page shows the traceback. The log line and the listener's reason name the exception's class and where it was raised; its message, which may carry an input value, only under `app.debug`.

### The outgoing response check

The boundary wraps `send` for each contract request. It holds `http.response.start` until the verdict, then passes the messages on. The verdict rules, the `responses` modes, `bodyValidation` and the completion of the idempotency record are ADR 0016's, as ADR 0023 applies them:

- **A declared success** the boundary wrote passes. Its body chunks keep the writer's pace (spike: three chunks 300 ms apart arrived at 7, 308 and 610 ms).
- **An undeclared status** is a violation before any byte is sent, streams included.
- **A declared error** is held up to `MAX_CHECKED_ERROR_BODY_BYTES = 65536` and checked for the api's format and a listed code. A `gzip` or `deflate` body is decoded first. A `br` body is a violation: Python's standard library cannot decode it (a parity gap listed in Consequences).
- **A reply the boundary did not write.** A success status (a 2xx or a 304) is a violation. Once the access dependency admitted the request, a reply that is neither the boundary's nor a contract exception's is a violation.
- **An ETag** the boundary did not set is stripped, and a 304 it did not write is a violation (`frameworkEtag: strip`, the default).
- **A changed reply.** A middleware between the boundary and the endpoint can change the reply. The boundary compares the status and the body with what it recorded, a body that a later layer compressed (`GZipMiddleware`) decoded first, and judges a different one as a reply it did not write.

Under `strict` a violation is replaced by the api's 500, and `onUnexpectedError` is called. A failure inside a stream, after the head went out, cannot be replaced: it is logged, `onUnexpectedError` is called and the body ends short. Under `warn` the reply goes out as written, and the violation is logged once.

A reply written by a middleware outside the boundary is not seen; the boot check refuses one, and so does the first-request fallback. An ASGI wrapper around the app object itself (`app = CORSMiddleware(FastAPI())`, an error tracker's ASGI wrapper, a parent Starlette app's middleware) runs before step 1 and is not seen either: the boot check reads only `app.user_middleware`. The FastAPI guide says so.

### Errors raised before the boundary

Before the boundary, the ASGI server, any ASGI wrapper around the app object and `ServerErrorMiddleware` run: the server's own limits (uvicorn's `--limit-concurrency` 503, its header limits), what such a wrapper answers, and an exception the boundary itself raises. Between the boundary and the endpoint, the app's inner middleware and its global and router dependencies refuse by raising `HTTPException` or by answering. Their replies are mapped as "Exceptions on contract routes" says.

### Types and validation

A rule's proof members in the body (ADR 0012 requirements) are read by the access steps from the decoded body and handed to the rule's decider; the typed body the handler reads leaves them out. The access steps check only a scalar proof's type, `uuid` format and length, as PHP's do; step 6 then validates every proof by its full type with `<Op>Proofs`, a model of the schemas module that the handler never reads, and reports its issues at the proof's body member.

Generated value types:

- Pydantic models for objects, with `ConfigDict(strict=True, protected_namespaces=())` and `extra` set by the object's unknown-key rule;
- a discriminated union of one model per variant for unions, with an `Unknown` variant only on input readers;
- `StrEnum` classes for enums;
- `T | None` for an optional or a nullable member (an optional member that is not nullable still refuses a wire `null`, ADR 0003 section 5), and `Field[T]` for a member both optional and nullable; presence is read from `model_fields_set` (spike);
- `datetime` for a `date-time`, kept with the offset it was sent with;
- `int` in the IR's safe range for integers, checked as whole numbers, so `1.0` is an integer (ADR 0003 Consequences).

The boundary decodes the held body with Python's `json` module into a tree that keeps objects and arrays apart. Path, query and headers are decoded by the IR's wire form. The input dependency then validates the tree with the operation's model, `model_validate(tree, strict=True)`. The generated type layer runs first, as annotated types whose `BeforeValidator` Pydantic runs before its strict check:

- a whole-number float in the safe range becomes an `int`; `1.5`, `true` and `"1"` stay refused (spike);
- a string carried on the wire for a `date-time`, a `date`, a `uuid`, a `decimal` or an enum member is parsed by the contract's rule, since strict mode refuses those strings on Python objects (spike);
- `{}` and `[]` stay apart: strict mode refuses an object for a list and a list for an object (spike).

FastAPI's own parameter parsing never runs on a contract route: the endpoint declares no parameter FastAPI parses, so FastAPI answers no 422 (spike). A refused input throws the generated `schemaInvalid` exception, so the 400 is rendered. Each issue carries its `{ in, pointer, rule }`, the contract rule name kept per Pydantic error type, bounded by `MAX_RENDERED_ISSUES = 100`.

The target takes `rules` (ADR 0009):

- **`native`, the default.** A value rule renders as Pydantic's own constraint wherever Pydantic has one: `min_length` and `max_length` (counted in code points, as the contract counts), `ge`, `gt`, `le`, `lt`, `multiple_of`, `pattern`. `enum` and `const` stay generated. A format Pydantic has no matching rule for stays a generated validator. The FastAPI guide lists the differences in a few lines.
- **`seampact-consistent`.** Every value rule is a generated validator with ADR 0003's meaning.

In both modes a `pattern` is the IR's normalised pattern (ADR 0003 section 9), checked by Pydantic's Rust engine; the generated models pin `regex_engine="rust-regex"`. Every normalised pattern of the golden IRs compiles there and gives the contract's verdicts, `$` before a final newline and `.` on an astral code point included (spike). The written pattern is never used: Rust's `\d` and `\w` are Unicode. The compiler already refuses lookaround and backreferences, which Rust refuses too, when the model class is built. So patterns give the same verdicts as on the other targets, and the FastAPI guide lists no pattern difference.

The contract input is the boundary's decoding, never `await request.json()` or `request.query_params`. The boundary replays the body bytes as received to the app through the wrapped `receive`, so app code that reads `await request.body()` sees them.

### Query and bounded values

The rules of ADR 0023 "Query and bounded values" hold, with these Python details:

- **Query.** Decoded from the raw `query_string` by the IR's wire form, with form decoding, never from `request.query_params`.
- **Body limit.** The boundary refuses a declared `Content-Length` above the route's limit before reading. It reads the `http.request` messages, decodes `gzip` and `deflate` with `zlib`, counts the encoded and the decoded bytes, and answers the route's 413 as soon as either passes the limit. Any other content coding answers 415; a corrupt compressed body is the client's 400.
- **Paging, deadlines, relays, keys, version tokens and absolute URLs** come from the shared runtime, as on the other targets. The public origin is the `public_origin` argument of `bind_<api>()`; the request host and forwarded headers are never read.
- **Order.** The input dependency reads a versioned write's version before the header check, so a missing `If-Match` answers `preconditionRequired` (428), never `schemaInvalid`; then it fills the paged limit, builds the typed input, applies the input field rights, checks the deadline and claims the idempotency key, a stored reply answering without the handler. The boundary completes the claim with the reply before its last message, and releases it when the request fails.
- **Several apis.** Each `bind_<api>()` adds its own boundary. Each boundary accepts the other apis' boundaries outside it, unless one claims this api's paths with its `catchAll` on.

### Redaction

Every generated class that holds a value of ADR 0023's "Redaction" list (credentials, the CSRF token, an identity's credentials, a signed request's body and signature, a `sensitive` member, who is calling) prints it as `[redacted]`:

- a dataclass gets a generated `__repr__` and `__rich_repr__`;
- a Pydantic model gets a generated `__repr_args__`, which Pydantic's `__repr__`, `__str__` and rich output read;
- raw body bytes live inside an object with a redacted `repr`, never in a bare local.

So `repr`, `str`, `pprint`, `logging` with `%r`, `rich`, and error trackers that capture frame locals by `repr` never show the value. `model_dump`, `dataclasses.asdict` and `json.dumps` still show it; the FastAPI guide says so.

The boundary's own logs go to the `seampact.<api>` logger of Python's `logging`, with the operation id, the rule and the pointer, never an input value. A logged pointer is cut to `MAX_LOGGED_POINTER_BYTES = 256` on a UTF-8 boundary, its control characters escaped.

### Options and registration

The target options, validated against the schema the target publishes, with unknown keys refused by name:

- `handlers`, `perResource` only (`options.handlers.unsupported` for `perOperation`, until an app needs it);
- `indent` (four spaces by default, as `ruff format` writes);
- `rules` (`native`, the default, or `seampact-consistent`);
- `responses` (`strict`, the default, or `warn`);
- `bodyValidation` (`false`, the default, or `true`);
- `frameworkEtag` (`strip`, the default, or `keep`);
- `catchAll` (`true`, the default, or `false`).

The naming options of ADR 0007 are refused by name (`options.naming.unsupported`), and so is `layout` (`options.layout.unsupported`): one package per api is the only layout.

At run time, `bind_<api>()` takes keyword arguments: `responses`, `body_validation`, `operations` (per operation, `responses`), and `public_origin`. An operation's value wins over the api's, which wins over the target option. The app passes values from its own settings (pydantic-settings, environment, files); the runtime reads no environment variable itself.

Hooks are factories that are FastAPI dependencies, passed to `bind_<api>()` keyed by the contract's names: `authenticate` per identity, `deciders` per right or rule, `scope_resolvers` per scope, `idempotency_store`, and `on_unexpected_error`. FastAPI resolves them per request as dependencies of the access dependency, so a hook can take `Depends(get_db)` and shares the request's cached session with the handler. An operation's access dependency depends only on the hooks it needs. A missing hook fails the boot check; at run time it answers 500 (ADR 0012 "Registration and per-right overrides"). The request context, the resolved scopes included, lives in the request scope.

Two apis are two `bind_<api>()` calls, each with its own router, boundary and boot check.

### The boot check

Before any other check, the generated `GENERATED_BY` is compared with `seampact.codegen.runtime.RUNTIME_VERSION` (ADR 0025 "Version guards", G3): another `major.minor` or a lower patch refuses the boot as `runtime.generated-for-other-version`. `seampact generate` never imports the app, so no step aside is needed.

The boundary runs the check on `lifespan.startup`. It forwards the lifespan to the app and runs the check when the app's own `lifespan.startup.complete` passes through its wrapped `send`, so routes the app's startup code adds are seen. On a failure it raises its error there. Starlette then answers `lifespan.startup.failed`, uvicorn logs "Application startup failed. Exiting." and exits with status 3, and `with TestClient(app)` raises the error (spike). Answering `lifespan.startup.failed` without raising would hang `TestClient` (spike).

Without a lifespan (`TestClient(app)` outside `with`, `uvicorn --lifespan off`), the boundary runs the same check once, on the first request, under a lock so concurrent first requests run it once. A failure answers the api's 500 on every contract request and logs the list.

The check lists every problem at once, with the operation id, the name and the fix:

- the hook problems of ADR 0016's list, read from the factories given to `bind_<api>()`;
- a contract operation without a handler factory, without a contract route, or with two (`bind_<api>()` called twice);
- a contract request that another route would take. The check uses Starlette's public matching, never FastAPI's route list: for each operation, it builds a scope with the method and `mount` followed by the contract path, a sample value in each placeholder, and runs it through `route.matches()` over `app.routes` in order. The first full match must be the entry `bind_<api>()` appended, captured as `target.routes[-1]` right after its `include_router`. When `target` is an `APIRouter`, the first full match over `app.routes` must be no `Route`, `Mount` or `Host` of the app, and the first one over `target.routes` must be the captured entry. So an app route with the same method and path, a convertor catch-all (`/{full_path:path}`), a parent `Mount` and a router included under a prefix ("without a contract route") are all refused, unless `frameworkRoutes` allow-lists the route that wins (review probes);
- a `frontend()` route at or under a base path. FastAPI 0.162 keeps those routes apart from `app.routes`, so the check reads them through FastAPI's own attribute, and a test of the target fails by name if a FastAPI minor moves it;
- a route or mount at or under one of the api's mounted base paths that no `bind_<api>()` made and that `frameworkRoutes` does not allow-list (FR-25); FastAPI's documentation routes are framework routes read from `app.docs_url`, `app.redoc_url`, `app.openapi_url` and `app.swagger_ui_oauth2_redirect_url`, accepted and listed in the report (ADR 0011). An allow-list entry must not shadow a contract path: an allow-listed route that wins over a contract request runs its handler, and only then is its reply replaced by the 404;
- the boundary not first in `app.user_middleware`: a middleware added after `bind_<api>()` sits outside it (spike); other seampact boundaries are accepted there, as "Several apis" says;
- an `app.exception_handlers` entry that can take an `HTTPException` ("Exceptions on contract routes") added or replaced after `bind_<api>()`, so it carries no wrapper;
- an `app.dependency_overrides` entry keyed by a generated dependency (the access dependency, an input dependency), which would reach the handler without steps 2 to 8; the first-request check refuses it too, since a test may set it after start;
- a `public_origin` set under relative URLs, or a missing or malformed one under absolute URLs;
- a FastAPI minor or a Starlette major that `generate` did not accept, or Pydantic 1, read with `importlib.metadata`. The generated code records the FastAPI minors `generate` accepted (the matrix's tested minors and the `allowUntested` ones) and the Starlette majors of the matrix, so a `pip install -U fastapi` after `generate` refuses the boot by name, as Laravel's boot check refuses a major other than 13. A Pydantic major other than 2 is refused alike. `generate` refuses an entry whose compatibility matrix has no FastAPI row (`config.matrix.row-missing`).

`artefacts.bootCheck: false` turns the whole check off; `{ frameworkRoutes: false }` turns the framework-route check off and `{ hooks: off }` the hook check, as on Laravel. The handler check runs whenever the boot check does.

### Native security layers

FastAPI's security tools stay the app's. An authenticate hook factory depends on the app's `Security` scheme (`OAuth2PasswordBearer`, `HTTPBearer`, `APIKeyHeader`), so FastAPI reads the credential and the hook decides. A scheme built with `auto_error=False` hands `None` to the factory, so a caller presenting another scheme of the identity (a session cookie) still reaches the hook; the consumer's `user` and `service` hooks read their token this way. The `HTTPException` 401 or 403 a scheme raises answers `unauthenticated` or `forbidden` ("Exceptions on contract routes"). FastAPI has no CSRF layer: the boundary checks the contract's CSRF header for a cookie-only caller. Per-access-kind dependency lists, as Laravel's `middleware.<kind>`, wait for an app that needs them.

### Native access instead of hooks

`artefacts.accessHooks: false` with `access: { native }` (ADR 0012) is refused by name until a consumer needs it, as on Laravel.

### What the shape-imposing features turn off with

The target imposes no wire shape ([A36](../decisions.md#a36)):

| Feature | Default | Switch |
|---|---|---|
| the outgoing check's 500 on a violation | strict | `responses: warn`, per api or per operation |
| validating success bodies | off | `bodyValidation: true` |
| stripping a framework ETag | strip | `frameworkEtag: keep` |
| the base-path 404 of unserved paths | on | `catchAll: false` |
| Pydantic's own value rules | native | `rules: seampact-consistent` |
| access hooks | on | `artefacts.accessHooks: false` with `access.native` |
| the boot check | on | `artefacts.bootCheck`, or `{ frameworkRoutes, hooks }` |
| contract routes in FastAPI's document | off | `artefacts.nativeDocs: true` |

### Native docs

`nativeDocs` is off by default, as on every target (ADR 0009). Contract routes are then registered with `include_in_schema=False`, so FastAPI's `/docs` and `/openapi.json` show the app's own routes only (spike). With `artefacts.nativeDocs: true`, the routes join FastAPI's document with seampact's operation objects, so it describes them as seampact's document does (ADR 0011, CHK-165). The Python runner gets that document from the pinned binary, which emits the document the entry names, else the one declared document that holds every route the entry generates, with the options the app's `openapi` gives it and no `servers`; the generator writes each kept operation's object and the components those operations reach to `native_docs.json`, and `bind_<api>()` places each object at its path under the entry's `mount` in `app.openapi()`. A component the app's own document holds with another value fails `/openapi.json`, naming it; a contract schema named `ValidationError` or `HTTPValidationError`, which FastAPI's document owns, fails `generate` with `artefacts.nativeDocs.component-clash`; a route `native_docs.json` lacks (a stale file) fails at boot, naming it, until `seampact generate` runs again. `frameworkDocs: keep` is the default; `frameworkDocs: off` makes `bind_<api>()` remove FastAPI's `/openapi.json`, `/docs`, `/docs/oauth2-redirect` and `/redoc`, as `FastAPI(openapi_url=None, docs_url=None, redoc_url=None)` does.

### Links and the client

The target consumes no link (ADR 0009 "The provider seam"): it generates its own Pydantic models. A link on its entry fails `generate` with `link.kind.not-consumed`. It generates no client.

### What the generated code depends on

At run time:

- Python 3.12 or later;
- `fastapi` from 0.162, with the Starlette it brings, and `pydantic` 2.9 or later;
- `seampact-hooks`, and `seampact-fastapi` with `seampact-codegen`, whose runtime the code imports.

The boundary runtime is imported, not copied (ADR 0025): the framework-neutral part from `seampact.codegen.runtime` and `seampact.codegen.runtime.pydantic`, shared with Ninja; the FastAPI part (the middleware, the dependencies, `bind_<api>()`'s registration, the exception map, the boot check) from `seampact.fastapi.runtime`. Generated code imports no other seampact package and no validation library beyond Pydantic. It never imports `seampact.signed_webhooks`: the app's authenticate hook calls it.

The generator's code sits in production `site-packages`, its dependencies behind the `generate` extra, as ADR 0025 accepted for PHP. Generated files print through the core's line printer (ADR 0015) and pass `ruff check`, `ruff format --check`, `mypy --strict` with the Pydantic plugin, and `pyright` strict, on Python 3.12 and the latest.

### Refused by name or waiting

`generate` refuses by name, with its code and fix, every input the target does not serve ([A47](../decisions.md#a47)). It reads only the operations the entry's `operations` filter keeps (ADR 0011).

| Waits for | What |
|---|---|
| a consumer that needs them | form, multipart, download and redirect bodies; native access (`artefacts.accessHooks: false`); sort keys restricted by a right; unions (`oneOf`); `handlers: perOperation`; per-access-kind dependency lists |
| after 1.0 | FastAPI minors below the floor and Pydantic 1 (refused, not waiting); `hooks: vendored` ([A40](../decisions.md#a40)); every IR form absent from the reference contract's golden IRs, as ADR 0023 lists them |

### The consumer and the proof

The sample app lives in `scripts/consumers/targets/fastapi/`. It holds the developer's handlers and hook doubles, which answer from the suite script, and three control routes: `/__seampact/script`, `hook-calls` and `log-lines`, the last fed by a `logging.Handler`. uvicorn may run several workers, so the script, the hook calls and the log lines live in one file. It installs `seampact-hooks`, `seampact-codegen`, `seampact-ir`, `seampact-fastapi` and `seampact-signed-webhooks` (its stripe hook verifies signatures) from wheels that `uv build` writes (ADR 0011 "Unpublished installs for test consumers"), and the reference contract's bundle.

The workflow `p7-fastapi.yml` has, beside `changes` and the `packages` tests:

- `contract-bundle` (Node), which bundles the reference contract with the compiler binary; the consumer fetches it from a local git repository with its integrity pin;
- `e2e`, two rows on `ubuntu-24.04` with `actions/setup-python`: {Python 3.12, FastAPI 0.162 with its floor Starlette and Pydantic} and {the latest Python, the latest FastAPI, Starlette and Pydantic}, both on uvicorn. Node is removed first, and the step fails if `node`, `npm` or `npx` is still found. It installs the app with pip only and generates. Node then comes back for the suite alone, which runs the `default`, `hand-written` and `boot` profiles (ADR 0015 "Suite profiles"), over every operation of the tasks and tasksService apis; a boot is a uvicorn start of a misconfigured variant;
- `fastapi`, the aggregate, failing on any failed or cancelled job, or one skipped although `changes` said run.

The proof is:

- the `node`-absent step;
- a green suite row per Python version;
- `python/fastapi`'s `test_redaction.py` (one generated class of each kind of "Redaction", holding a known secret, which `repr`, `str`, `pprint`, `logging` with `%r` and `rich` must not show while `[redacted]` is present), and the suite's security rows.

The suite runs every case of the reference contract: the consumer's refusal list is empty.

### Delivery

| PR | Delivers |
|---|---|
| py-core-5 | `python/codegen`: the neutral plan, names, layout, refusals, the Pydantic emitter, route table data and route helpers; the shared runtime's step 1 decoding, raw-target match, replies, verdict and version |
| fastapi-1 | `python/fastapi`: the generator in the entry point group, the options, models, handler protocols, router declarations, exceptions per error, `bind_<api>()`; a golden for the reference contract under `ruff`, `mypy --strict` and `pyright` strict on Python 3.12 and the latest |
| fastapi-2 | the boundary (steps 1 and 10), the access and input dependencies (steps 2 to 8), the exception map, the lifespan boot check and its first-request fallback, the 500 on a missing hook, scopes in the request scope; the sample app, the `default`, `hand-written` and `boot` profiles, the e2e job of `p7-fastapi.yml` |
| fastapi-3 | paging, idempotency, throttle, cache headers, field rights, version tokens, deadline headers, the signed raw body, redaction; the suite over every operation of the tasks api and `test_redaction.py` |
| fastapi-4 | absolute URLs, relays with the tasksService api; authenticate hooks on FastAPI `Security` schemes; CORS and docs routes beside the boundary |

## Spike

Run on CPython 3.12.16 with uvicorn 0.54.0, hypercorn 0.18.0 and httpx 0.28.1, in two environments, and not kept: FastAPI 0.162.0 with its floor Starlette 0.46.0 and Pydantic 2.9.0 (pydantic-core 2.23.2), and FastAPI 0.162.0 with Starlette 1.10.0 and Pydantic 2.14.2 (pydantic-core 2.50.2). Every row gave the same result in both. A reduced placement had a pure ASGI boundary added last, a router with a route dependency and an endpoint-parameter dependency, a `def` handler factory depending on `get_db`, and a streamed route. Requests went through `TestClient`, and through raw sockets to uvicorn and hypercorn.

| Case | Result |
|---|---|
| dependency order | app global, router, route `dependencies`, then endpoint parameters in signature order, then the endpoint |
| `HTTPException(401)` from an app global dependency | rendered inside by `ExceptionMiddleware`; the boundary saw a 401 reply and no exception. With the app's handler wrapped before the stack was built, the boundary read `HTTPException 401` from the request scope |
| an exception from a handler | crossed the boundary, which answered its 500 |
| `scope["route"]` | set by the router on both Starlette versions; `/v1/tasks/%73earch` chose the search route while the raw match was `{task_id}` |
| boot check raising at the app's `lifespan.startup.complete`, under uvicorn | `lifespan.startup.failed` from Starlette, "Application startup failed. Exiting.", exit status 3 |
| the same under `with TestClient(app)`; answering `startup.failed` without raising | `TestClient` raised the boundary's error; `TestClient` hung, uvicorn exited 3 |
| `TestClient(app)` without `with`; `uvicorn --lifespan off` | no lifespan, requests served |
| `/v1/tasks/%73earch`, `a%2Fb`, `7%3Bx=1`, `%2e%2e`, `?x=%20+1&a.b=1` under uvicorn, hypercorn, `TestClient` | `raw_path` as sent, without the query; `path` decoded (`search`, `a/b`, `7;x=1`, `..`); `query_string` raw |
| an app route with a trailing slash; a contract path with one | 307 to the path without it; the boundary's 404 before routing |
| three chunks 300 ms apart through the wrapped `send`, start held until the verdict | at 7, 308 and 610 ms under uvicorn; 7, 308 and 609 ms under hypercorn |
| a malformed JSON body to an endpoint with only `Request` and dependencies | reached the endpoint, no 422 |
| `app.dependency_overrides[get_db]` | replaced the handler factory's own dependency; the `def` factory ran in a worker thread |
| `include_in_schema=False` | the contract routes were absent from `/openapi.json` |
| strict `int` on `1.0`; with a whole-number `BeforeValidator` | refused (`int_type`); `1.0` accepted as `1`, `1.5`, `true` and `"1"` refused |
| strict list on `{}`, dict on `[]`, model on `[]` and on `{}` | refused, refused, refused, accepted |
| strict, on Python objects, a string for `datetime`, `date`, `UUID`, `Decimal`, `StrEnum` | refused; accepted from JSON text |
| `model_fields_set` on `{}` and `{"note": null}` | empty; `note` |
| the 12 normalised patterns of the golden IRs under `rust-regex` | all compiled; `createdAt\n` and `a` U+00A0 `b` refused, `a` U+1F600 `b` accepted by `.` |
| `b` on `abc`; `\d` on U+0663; lookahead; backreference | matched (search); matched (Unicode); `SchemaError` when the model was built; `SchemaError` |
| a `def` hook through `run_in_threadpool`; an `async def` hook | a worker thread with the caller's context variables; the event loop thread |
| `add_middleware(CORSMiddleware)` after the boundary; after start | `CORSMiddleware` outside the boundary; `RuntimeError` |
| a Pydantic model with a generated `__repr_args__` hiding a member | `repr`, `str` and `__rich_repr__` printed `[redacted]` |

The review of this ADR ran more probes on the same two environments, with the same result on both:

| Case | Result |
|---|---|
| an app handler for `fastapi.HTTPException`, or for `401`, then Starlette's `HTTPException` handler wrapped; a dependency raises `fastapi.HTTPException(401)` | the app's handler answered; the wrapper was never called |
| a `/{full_path:path}` route or `app.mount("/v1", ...)` before the contract router; `GET /v1/tasks/7` | the catch-all or the mount answered 200 |
| the first `Match.FULL` over `app.routes` for a scope `GET /v1/tasks/x` | the catch-all, the `Mount`, or the entry holding the contract route when none of them exists |
| a router included, then a route added to it | the late route served; `app.routes` held no `APIRoute`; `scope["route"]` the original route |
| an app global dependency, then a hook factory, with a missing `Header()` | 422 after the access dependency, the input dependency and the factory ran; with the hook factory, the access dependency skipped |
| `HEAD` on an `APIRoute` registered for `GET` | 405 |
| `app.dependency_overrides` on the route and input dependencies | the endpoint reached, 200 |
| `TestClient(app, root_path="/api")` | `path` and `raw_path` without `/api`, `root_path` `/api` |

Starlette 1.10's `TestClient` warns that `httpx` is deprecated in favour of `httpx2`; fastapi-2 picks the client its tests use.

## Consequences

- An app keeps its routes, its middleware, its dependencies, its exception handlers and its settings. On contract routes the boundary's checks and reply win.
- The app calls one function per api, last. A middleware added after it is refused at boot.
- Handlers are classes behind a protocol, not decorated functions; `Depends`, the per-request dependency cache and `dependency_overrides` still work. The FastAPI guide shows it first.
- FastAPI's 422 never answers on a contract route; the contract's 400 does.
- A `def` handler or hook runs in anyio's threadpool, shared with FastAPI's own `def` dependencies.
- A path value whose percent-decoding is not UTF-8, `%2F` in a segment and a dot segment answer the path's 404, as on Laravel.
- A `br` error body is a violation here, where ADR 0016 decodes it.
- `model_dump`, `asdict` and `json.dumps` show sensitive values; `repr`-based tools do not.
- Under `rules: native`, Pydantic's value rules give their own verdicts, listed in the FastAPI guide; patterns behave the same in both modes.
- An ASGI server without `raw_path` loses the raw-path rules; the boundary says so once at start.
- ADR 0012's target tables gain a fastapi row in the lead's follow-up: steps 1 and 10 in a pure ASGI middleware, steps 2 to 5 in a route dependency, steps 6 to 8 in an endpoint dependency.

## Traceability

- FRs: FR-5 (the check order), FR-14 (cases refused by name), FR-16 (server boundaries, handlers stay the developer's), FR-17 (distribution and the app config), FR-20 (signed webhooks), FR-21 (native targets, Python by A48), FR-25 (framework routes and the boot check), FR-35 (the shared suite), FR-40 (generated IR models); CHK-158, CHK-161, CHK-165, CHK-168; amendments A9, A36, A40, A41, A47, A48.
- ADRs: 0003 (the decoding and the patterns), 0007 (Python names), 0009 (artefacts, `rules`, matrix), 0010 (the Python channels), 0011 (app config, `mount`, unpublished installs), 0012 (placement and obligations), 0013 (raw body), 0015 (printing, golden tests, suite profiles), 0016 and 0023 (the shared obligations and the placement this one mirrors), 0025 (runtime packaging, version guards), 0027 (the Django targets on this core).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate on the FastAPI consumer.

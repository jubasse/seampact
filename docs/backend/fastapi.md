# Write the handlers (FastAPI)

`seampact-fastapi` generates the contract's Python code for FastAPI. You write the handlers and the hooks; the generated boundary checks each request and each reply.

## Set up

Python 3.12 or later, FastAPI 0.162 (a later minor is untested, see [Versions](#versions)), and Pydantic 2.9 or later. Pydantic 1 is refused. CI runs the oldest FastAPI (0.162) and the latest.

Nothing is on PyPI yet, so you install seampact from your checkout. Replace `~/src/seampact` with the path of your checkout. Install uv 0.13.6 (the workspace pins it). Build the wheels once, then make the requirements file of the third-party packages:

```sh
sh ~/src/seampact/scripts/consumers/python/build-wheels.sh ~/src/seampact/python/dist
sh ~/src/seampact/scripts/consumers/python/requirements.sh /tmp/requirements.txt seampact-fastapi generate uvicorn
```

In your app, install the third-party packages first, then seampact from the wheels. The second command never asks an index for a `seampact-*` name. `requirements.sh` refuses an existing output file: give it a new path on a re-run.

```sh
cd ~/src/notes-app
python3 -m venv .venv && . .venv/bin/activate
pip install --require-hashes --no-deps --only-binary :all: -r /tmp/requirements.txt
pip install --no-index --find-links ~/src/seampact/python/dist "seampact-fastapi[generate]"
```

`uv pip install` takes the same flags. The `generate` extra holds the generator and its dependencies: keep it in your dev dependencies, and install plain `seampact-fastapi` in production. Add `seampact-signed-webhooks` if a route is signed by a sender: `pip install --no-index --find-links ~/src/seampact/python/dist seampact-signed-webhooks`.

In `seampact.config.yaml`, add one entry per api:

```yaml
outDir: generated
openapi: none
sources:
  notes:
    git: { url: "https://git.example.com/notes-contract.git", tag: v1.0.0, directory: bundle }
    integrity: sha256-...
targets:
  - id: notes
    out: notes
    use: pypi:seampact-fastapi
    api: notes
    options: { rules: seampact-consistent }
```

The compiler binary is not published yet. A `path` source and the OpenAPI documents need it, and `generate` stops with `binary.unpublished` without it. Until 1.0, either read a pinned bundle (a `git` or `release` source, as above) and set `openapi: none`, or point your root `pyproject.toml` at your own build of the compiler:

```toml
[tool.seampact.binary]
path = "tools/seampact"
sha256 = "<the SHA-256 of that file>"
```

Then generate:

```sh
seampact generate
```

The code goes into `generated/notes/`. Import it as `generated.notes.fastapi`, `generated.notes.operations` and `generated.notes.schemas`. Commit the generated files. `seampact check` fails CI when they drift from the contract.

Options of the entry (all optional), set under `options:`:

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses Pydantic's own value rules. `seampact-consistent` gives the contract's exact checks, equal on every target. |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `bodyValidation` | `false` | Checks success bodies against the contract. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

Also on the entry: `mount` (a path prefix), `frameworkRoutes` (see [The boot check](#the-boot-check)), `frameworkDocs`, `allowUntested`, and under `artefacts`: `routeHelpers`, `nativeDocs` and `bootCheck`. The other options are refused by name, see [Limits](#limits).

## Wire it in

`bind_notes()` is the one call your app makes. Make it last, after your own middleware and exception handlers.

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from generated.notes.fastapi import NotesHandlerFactories, bind_notes

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["https://app.example.com"])

bind_notes(
    app,
    handlers=NotesHandlerFactories(notes=notes_endpoints),
    authenticate={"user": user_hook},
    deciders={"notes.update": NotesDecider},
    scope_resolvers={"workspace": WorkspaceResolver},
    on_unexpected_error=NotesErrors,
)
```

- It adds the contract's routes, the exception handlers and the boundary. The boundary is the outermost middleware of the app.
- `handlers` has one factory per resource. `authenticate` has one hook factory per identity, `deciders` one per right or rule, `scope_resolvers` one per scope. Keys are the contract's names.
- Add `public_origin="https://api.example.com"` when the contract writes absolute URLs. The boot check refuses it under relative URLs.
- Settings come from your code: `responses`, `body_validation` and `operations` (per operation, `responses`) override the entry's options. seampact reads no environment variable. Read your own settings and pass them in.
- With two apis, call `bind_<api>()` twice.
- To use an `APIRouter`, pass it as the first argument and add `app=app`. Call `bind_notes()` before `app.include_router(router)`. A prefix on that router is refused: use `mount` on the entry.

Add `CORSMiddleware` before `bind_notes()`. A preflight request passes the boundary and reaches it.

Each route is named `seampact.<api>.<operationId>`, and its parameters take the input property names. `NotesRouteNames` holds the names and `NotesUrls` builds the paths. `artefacts: { routeHelpers: false }` leaves both out.

A path segment that mixes a parameter with text, or holds `{`, `}` or `?`, is refused by `generate` (`path.segment.mixed.unsupported`, `path.segment.literal.unsupported`).

## Write a handler

Write one class per resource. It implements the generated `<Resource>Endpoints` protocol. A factory builds it, and the factory is a FastAPI dependency, so it takes your own dependencies:

```python
from fastapi import Depends
from generated.notes.operations import GetNoteErrors, GetNoteRequest, GetNoteResponse200, GetNoteResult


class NotesEndpoints:
    def __init__(self, notes: NoteRepository) -> None:
        self.notes = notes

    async def get_note(self, request: GetNoteRequest) -> GetNoteResult:
        note = await self.notes.get(request.input.path.note_id)

        if note is None:
            return GetNoteErrors.api_not_found()

        return GetNoteResponse200(note)


def notes_endpoints(notes: NoteRepository = Depends(get_notes)) -> NotesEndpoints:
    return NotesEndpoints(notes)
```

- A method is a plain `def` or an `async def`. A `def` runs in FastAPI's thread pool (40 threads by default, shared with your other `def` dependencies).
- `request.input` holds the checked path, query, headers and body, typed. The input is checked before your factory runs, so no session opens for a bad request.
- You never write a status or a content type. Return one arm of the result (`GetNoteResponse200`), or an error (`GetNoteErrors.api_not_found()`). You can raise the same error instead.
- A reply that breaks the contract answers 500. So does any other exception, and `on_unexpected_error` hears it.

When an operation takes a version, the boundary checks its format only. Compare it with the stored version yourself, and return the operation's conflict error when they differ:

```python
if request.input.body.expected_version != task.version:
    return UpdateTaskErrors.state_conflict()
```

A deadline is a declared header. `request.deadline` is `None` when the caller sent none. Check `request.deadline.has_passed(datetime.now(UTC))` while you work, and answer the operation's deadline error (`GetNoteErrors.api_deadline_exceeded()`). `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, `request.principal` is the caller, typed as the generated `<Identity>Principal`. It is `None` for an anonymous caller on an optional-auth route. A public route has no `principal`.

When the route runs in scopes, `request.scopes` has one attribute per scope, each the `ResolvedScope` your resolver returned, with its `id` and `value`:

```python
workspace = request.scopes.workspace.value
user_id = request.principal.user_id
```

Neither is part of the input, and the client cannot set them. Both print as `[redacted]`.

## Write the hooks

A hook is a class. Its factory is a FastAPI dependency, so it can take `Depends(...)` and `Security(...)`. FastAPI reads the credential, and the hook decides.

```python
from typing import Annotated

from fastapi import Security
from fastapi.security import OAuth2PasswordBearer

from seampact.hooks import AuthenticateRequest, AuthenticateResult, ErrorCodeWithParams, authenticate_result

bearer = OAuth2PasswordBearer(tokenUrl="/token", auto_error=False)


class UserHook:
    def __init__(self, token: str | None) -> None:
        self.token = token

    async def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        user_id = None if self.token is None else await tokens.user_of(self.token)

        if user_id is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code="api.unauthenticated"))

        return authenticate_result.Authenticated(principal=UserPrincipal(user_id=user_id))


def user_hook(token: Annotated[str | None, Security(bearer)]) -> UserHook:
    return UserHook(token)
```

- `auto_error=False` hands `None` to the factory, so a caller with another credential of the identity (a session cookie) still reaches the hook. The credentials the contract declares are in `request.credentials`.
- A scheme that raises `HTTPException` 401 or 403 answers the contract's `unauthenticated` or `forbidden` error.
- A decider has `decide(request)` and returns `decision.Allowed()` or `decision.Denied(deny=ErrorCodeWithParams(code=...))`. A scope resolver has `resolve_scope(request)` and returns `scope_resolution.Resolved(resolved=ResolvedScope(...))` or `scope_resolution.Denied(deny=...)`. They come from `seampact.hooks`. The `params` of a right or rule in the request is an instance of its generated params class (a Pydantic model), not a dict: for a right declared with `params: { allowed: [...] }`, read `request.params.allowed`.
- An idempotency store is a factory for an object with `begin`, `complete` and `abandon` (`seampact.hooks.IdempotencyStore`). Pass it as `idempotency_store=`. Use it when an operation is idempotent.
- The unexpected-error listener has `on_unexpected_error(failure)`. It hears each 500 the api answers.
- FastAPI has no CSRF layer. The boundary checks the contract's CSRF header for a caller with a cookie only.
- To verify a signed webhook, call `seampact-signed-webhooks` in the authenticate hook. The raw body is `request.signature.raw_body`; `request.signature` is `None` on an unsigned route. `TemplateSignatureVerifier` checks a template signature. A signature your application verifies is refused (`signature.application.unsupported`).

### FastAPI's own errors

On a contract route, `HTTPException` and the other errors of your dependencies and middleware answer the contract's error of their status. 401, 403, 404, 413, 429 and 503 map to `unauthenticated`, `forbidden`, `notFound`, `payloadTooLarge`, `rateLimited` and `serviceUnavailable`, with `Retry-After` kept on 429 and 503. Without that error, the operation's one code of that status answers, if it has exactly one. Otherwise the reply is a logged 500. Your own routes keep your handlers.

Under `app.debug`, an unexpected exception shows Starlette's debug page, as on any route.

## Docs

FastAPI's `/docs` and `/openapi.json` show your own routes only. To add the contract's routes, set `nativeDocs` on the entry:

```yaml
    artefacts: { nativeDocs: true }
```

Each route then appears in FastAPI's document as the contract describes it. `generate` writes `native_docs.json` beside the code, and `bind_notes()` adds it to `app.openapi()`.

- `nativeDocs` needs the compiler binary, since it gets the document from it. Until 1.0, set `[tool.seampact.binary]` as shown in [Set up](#set-up).
- A contract schema named `ValidationError` or `HTTPValidationError` is refused (`artefacts.nativeDocs.component-clash`): FastAPI owns those names.
- Run `seampact generate` again when the contract changes. A stale `native_docs.json` stops the app at boot.
- `frameworkDocs: off` on the entry removes `/openapi.json`, `/docs` and `/redoc`.

More in [OpenAPI and docs](../configuration/openapi-and-docs.md).

## Test your routes

Go through the boundary with the `TestClient`. It needs `httpx2`, which the dev dependency group holds. Use it as a context manager, so the startup runs the boot check:

```python
def test_get_note() -> None:
    app = create_app(user_hook=lambda: FakeUserHook("alice"))

    with TestClient(app) as client:
        reply = client.get("/v1/notes/n-1", headers={"Authorization": "Bearer test-token"})

    assert reply.status_code == 200
```

- Build the app in a function that takes the hook factories, and pass fakes in the test. Replace a decider, a resolver or a store the same way.
- Send the credential the contract requires. The boundary asks for it before your hook runs.
- Never put the generated access or input dependencies in `app.dependency_overrides`: the boot check refuses it, since it would reach your handler without any check. Override the handler factory or its own dependencies instead (`app.dependency_overrides[get_notes]` is allowed).
- Without `with`, the boot check runs on the first request instead.
- To call a handler directly, build its request class from `generated.notes.operations` yourself. That request skips the boundary, so use it for unit tests only.

## The boot check

The app refuses to start, and lists every problem, when:

- an identity has no authenticate hook, a right or rule no decider, a scope no resolver, an idempotent operation no store;
- an operation has no handler, or its route is missing or served twice;
- a route of yours would take a contract request, or sits under the api's base path and `frameworkRoutes` does not allow-list it;
- the boundary is not the first middleware, so a middleware was added after `bind_notes()`;
- an exception handler for `HTTPException` was added after `bind_notes()`;
- the contract writes absolute URLs and `public_origin` is missing, or it writes relative URLs and `public_origin` is set;
- the FastAPI minor is one that `generate` did not accept, or Pydantic is 1.

It runs on startup (uvicorn exits with `Application startup failed. Exiting.`). Each message names the fix; find it in [Boot errors](../troubleshooting/boot.md#fastapi).

Allow-list your own routes in the entry, with a reason. FastAPI's `/docs`, `/redoc` and `/openapi.json` need no entry.

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Back office, not part of the api." }
```

`artefacts: { bootCheck: false }` turns the check off. `{ frameworkRoutes: false }` turns off its route part, and `{ hooks: off }` its hook part. `hooks` takes `error` (default) or `off`; `warn` is refused (`artefacts.bootCheck.hooks.warn.unsupported`).

## Versions

FastAPI breaks in minors, so seampact tests them one by one. 0.162 is the floor, and an older minor fails with `config.matrix.incompatible`. A newer minor prints `config.matrix.untested`. Accept it on the entry with `allowUntested: [fastapi@0.163]`, or make it fail with `checks: { matrix: error }`. After `pip install -U fastapi`, run `seampact generate` again: the boot check refuses a minor that `generate` did not accept.

### Starlette

seampact accepts every Starlette that FastAPI accepts, from 0.46, and tests 0.46 and the latest release. Old Starlette releases have known security flaws, fixed in later ones, but seampact does not raise its floor for them, the same choice FastAPI makes:

- `pip install` already picks the latest Starlette. An old one stays only when your project pins it, another package holds it back, or the environment is never updated. A higher floor in seampact changes none of these.
- A higher floor would refuse projects that cannot move yet, for a flaw that may not touch them.

So keeping Starlette current is your project's job. Run `pip install -U starlette`, and let `pip-audit` (or your security scanner) tell you when an update fixes a flaw. To enforce it, add your own floor, for example `starlette>=1.3.1`, to your project's requirements.

## Limits

- Run a server that gives the raw request path. uvicorn does. Where the server gives none, the boundary matches the decoded path and logs which rules it cannot apply.
- An ASGI wrapper around the app object (`app = CORSMiddleware(FastAPI())`, an error tracker) runs before the boundary and is not seen. Add middleware with `app.add_middleware()`.
- The outgoing check cannot read a `br` error body: it is a violation.
- `generate` refuses by name: form, multipart, file, download and redirect bodies, query lists in `brackets` form (`tag[]=a`) and lists of lists, `oneOf` unions, `handlers: perOperation`, `indent` other than 4, the naming options and `layout`, `accessHooks: false`, and a link on the entry. See [Target option errors](../troubleshooting/generate.md).
- FastAPI older than 0.162 is refused.
- DRF and Ninja are separate targets: see [Django REST Framework](drf.md).

## Versioned writes and query lists

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

A query list of scalars or enums is read in the default `repeat` form (`tag=a&tag=b`) or as `comma`. The `brackets` form and a list of lists are refused by `generate`.

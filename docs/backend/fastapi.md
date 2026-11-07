# FastAPI

`seampact-fastapi` generates the contract's Python code for FastAPI. You write the handlers and the hooks; the generated boundary checks each request and each reply.

FastAPI 0.162 and later, Python 3.12 or later. See [Versions](#versions) and [Supported versions](../supported-versions.md).

## Set up

You need:

- Python 3.12 or later;
- FastAPI 0.162 (a later minor is untested, see [Versions](#versions));
- Pydantic 2.9 or later. Pydantic 1 is refused.

Install seampact from PyPI. Put the generator in your dev dependencies and the runtime in production:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-fastapi[generate]"
```

`uv pip install` and `uv add --dev` take the same requirement. In production, install plain `seampact-fastapi`. Add `seampact-signed-webhooks` if a route is signed by a sender.

A `path` source and the OpenAPI documents need the compiler. Add the extra `seampact-ir[compiler]`, which installs the `seampact-compiler` wheel for your platform. A bundle-only app with `openapi: none` does not need it.

In `seampact.config.yaml`, add one entry per api. Replace the `git` url, the tag and `integrity` with your contract's: `integrity` is the hash `seampact bundle` printed when you published it (see [Share contracts](../features/sharing-contracts.md)). To try a contract in a local folder, use `path: ./contract` instead and install the compiler extra above.

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

The request is checked by [Pydantic](../types-and-validation/pydantic.md) models; see [Types and validation](../types-and-validation/README.md).

Then generate:

```sh
seampact generate
```

The code goes into `generated/notes/`. Import it as `generated.notes.fastapi`, `generated.notes.operations` and `generated.notes.schemas`. Commit the generated files ([Generated files](../configuration/config-file.md#generated-files)). `seampact check` fails CI when they drift from the contract; [Commands per stack](../features/commands-per-stack.md) shows how to run it.

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

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

A deadline is a declared header. `request.deadline` is `None` when the caller sent none. Check `request.deadline.has_passed(datetime.now(UTC))` while you work, and answer the operation's deadline error (`GetNoteErrors.api_deadline_exceeded()`). `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, `request.principal` is the caller, typed as the generated `<Identity>Principal`. It is `None` for an anonymous caller on an optional-auth route. A public route has no `principal`.

When the route runs in scopes, `request.scopes` has one attribute per scope, each the `ResolvedScope` your resolver returned, with its `id` and `value`:

```python
workspace = request.scopes.workspace.value
user_id = request.principal.user_id
```

Neither is part of the input, and the client cannot set them. Both print as `[redacted]`.

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
- Add `CORSMiddleware` before `bind_notes()`. A preflight request passes the boundary and reaches it.
- With two apis, call `bind_<api>()` twice.
- To use an `APIRouter`, pass it as the first argument and add `app=app`. Call `bind_notes()` before `app.include_router(router)`. A prefix on that router is refused: use `mount` on the entry.

Each route is named `seampact.<api>.<operationId>`, and its parameters take the input property names. `NotesRouteNames` holds the names and `NotesUrls` builds the paths. `artefacts: { routeHelpers: false }` leaves both out.

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

`auto_error=False` hands `None` to the factory, so a caller with another credential of the identity (a session cookie) still reaches the hook. The credentials the contract declares are in `request.credentials`.

- A decider has `decide(request)` and returns `decision.Allowed()` or `decision.Denied(deny=ErrorCodeWithParams(code=...))`.
- A scope resolver has `resolve_scope(request)` and returns `scope_resolution.Resolved(resolved=ResolvedScope(...))` or `scope_resolution.Denied(deny=...)`.
- They come from `seampact.hooks`. The `params` of a right or rule in the request is an instance of its generated params class (a Pydantic model), not a dict: for a right declared with `params: { allowed: [...] }`, read `request.params.allowed`.
- An idempotency store is a factory for an object with `begin`, `complete` and `abandon` (`seampact.hooks.IdempotencyStore`). Pass it as `idempotency_store=`. An idempotent operation needs one.
- The unexpected-error listener has `on_unexpected_error(failure)`. It hears each 500 the api answers.
- FastAPI has no CSRF layer. The boundary checks the contract's CSRF header for a caller with a cookie only.
- To verify a signed webhook, call `seampact-signed-webhooks` in the authenticate hook. The raw body is `request.signature.raw_body`; `request.signature` is `None` on an unsigned route. `TemplateSignatureVerifier` checks a template signature. A signature your application verifies is refused (`signature.application.unsupported`).

### Use FastAPI's own auth

Your dependencies and middleware work beside the contract. On a contract route, `HTTPException` and the other errors they raise answer the contract's error of their status. 401, 403, 404, 413, 429 and 503 map to `unauthenticated`, `forbidden`, `notFound`, `payloadTooLarge`, `rateLimited` and `serviceUnavailable`, with `Retry-After` kept on 429 and 503. A scheme that raises `HTTPException` 401 or 403 answers `unauthenticated` or `forbidden`.

Without that error, the operation's one code of that status answers, if it has exactly one. Otherwise the reply is a logged 500. Your own routes keep your handlers.

## Options

Set under `options:` on the target entry.

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses Pydantic's own value rules. `seampact-consistent` gives the contract's exact checks, equal on every target. See [Pydantic](../types-and-validation/pydantic.md#native-or-consistent-rules). |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `bodyValidation` | `false` | Checks success bodies against the contract. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

Also on the entry: [`mount`](../configuration/reference.md#mount) (a path prefix), [`frameworkRoutes`](../configuration/reference.md#framework-routes) (see [The boot check](#the-boot-check)), `frameworkDocs`, `allowUntested`, and under `artefacts`: `routeHelpers`, `nativeDocs` and [`bootCheck`](../configuration/reference.md#boot-check). Settings set on a group flow down to the routes below it: see [Settings flow down the tree](../contract/01-basics.md#settings-flow-down-the-tree). The full list is in the [configuration reference](../configuration/reference.md#seampact-fastapi).

### Change a setting at run time

Settings come from your code. Pass `responses`, `body_validation`, `public_origin` and `operations` (per operation, `responses`) to `bind_notes()`: they override the entry's options. seampact reads no environment variable. Read your own settings and pass them in.

## Docs

FastAPI's `/docs` and `/openapi.json` show your own routes only. To add the contract's routes, set `nativeDocs` on the entry:

```yaml
    artefacts: { nativeDocs: true }
```

Each route then appears in FastAPI's document as the contract describes it. `generate` writes `native_docs.json` beside the code, and `bind_notes()` adds it to `app.openapi()`.

- `nativeDocs` needs the compiler: install `seampact-ir[compiler]`.
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

To call a handler directly, build its request class from `generated.notes.operations` yourself. That request skips the boundary, so use it for unit tests only.

### Debug locally

Under `app.debug`, an unexpected exception shows Starlette's debug page, as on any route. A reply that breaks the contract is still a 500. To see it while you work, pass `responses="warn"` to `bind_notes()` in your local settings: the reply goes out and the log names the problem.

## Deploy

- Run uvicorn, which gives the raw request path. Where the server gives none, the boundary matches the decoded path and logs which rules it cannot apply.
- To serve the api under a prefix, set `mount: /api` on the entry. Page links add the ASGI `root_path` (uvicorn's `--root-path`) to the contract path, so set it when a proxy strips a prefix before the app.
- When the contract writes absolute URLs, pass `public_origin="https://api.example.com"` to `bind_notes()`. The request's `Host` is never read.
- An ASGI wrapper around the app object (`app = CORSMiddleware(FastAPI())`, an error tracker) runs before the boundary and is not seen. Add middleware with `app.add_middleware()`.
- The outgoing check cannot read a `br` error body: it is a violation.

In Docker, install plain `seampact-fastapi`. The generated code is committed, so the image needs no compiler.

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Read your settings from environment variables in `main.py` and pass them to `bind_notes()`. Never bake secrets into the image.

### The boot check

The app refuses to start, and lists every problem. It runs on startup (uvicorn exits with `Application startup failed. Exiting.`). Each message names the fix; find it in [Boot errors](../troubleshooting/boot.md#fastapi).

| Fault | Fix |
|---|---|
| An identity has no authenticate hook, a right or rule no decider, a scope no resolver. | Pass it to `bind_notes()`. |
| An idempotent operation has no store. | Pass `idempotency_store=`. |
| An operation has no handler, or its route is missing or served twice. | Give `handlers=` a factory for each resource; call `bind_notes()` once. |
| A route of yours would take a contract request, or sits under the api's base path and `frameworkRoutes` does not allow-list it. | Move it, or allow-list it. |
| The boundary is not the first middleware: a middleware was added after `bind_notes()`. | Add your middleware before `bind_notes()`. |
| An exception handler for `HTTPException` was added after `bind_notes()`. | Add it before. |
| The contract writes absolute URLs and `public_origin` is missing, or it writes relative URLs and `public_origin` is set. | Pass it, or remove it. |
| The FastAPI minor is one that `generate` did not accept, or Pydantic is 1. | Run `seampact generate` again, or use Pydantic 2. |

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

- `generate` refuses some forms by name, until an app needs them. The list is in [Generate errors](../troubleshooting/generate.md#python); forms refused on every server are under [every server](../troubleshooting/generate.md#every-server).
- A sort key restricted by a right is refused (`paging.sortKey.right.unsupported`). A query list is read in the default `repeat` form (`tag=a&tag=b`) or as `comma`.
- DRF and Ninja are separate targets: see [Django REST Framework](drf.md) and [Django Ninja](ninja.md).

## Next

- [Call the api from React](../frontend/react.md)
- [Call it with the fetch client](../frontend/fetch-client.md)
- [Check the generated code in CI](../features/check-in-ci.md)

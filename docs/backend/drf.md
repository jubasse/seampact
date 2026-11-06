# Write the handlers (Django REST Framework)

`seampact-drf` generates the contract's Python code for Django REST Framework. You write the handlers and the hooks; the generated boundary checks each request and each reply.

## Set up

Python 3.12 or later, Django 5.2 or 6, and DRF 3.18. CI runs the oldest of each and the latest. Pydantic is not needed.

Nothing is on PyPI yet, so you install seampact from your checkout. Replace `~/src/seampact` with the path of your checkout. Install uv 0.13.6 (the workspace pins it). Build the wheels once, then make the requirements file of the third-party packages. The last word is your server, `gunicorn` or `uvicorn`:

```sh
sh ~/src/seampact/scripts/consumers/python/build-wheels.sh ~/src/seampact/python/dist
sh ~/src/seampact/scripts/consumers/python/requirements.sh /tmp/requirements.txt seampact-drf generate gunicorn
```

In your app, install the third-party packages first, then seampact from the wheels. The second command never asks an index for a `seampact-*` name. `requirements.sh` refuses an existing output file: give it a new path on a re-run.

```sh
cd ~/src/shop-app
python3 -m venv .venv && . .venv/bin/activate
pip install --require-hashes --no-deps --only-binary :all: -r /tmp/requirements.txt
pip install --no-index --find-links ~/src/seampact/python/dist "seampact-drf[generate]"
```

`uv pip install` takes the same flags. The `generate` extra holds the generator and its dependencies: keep it in your dev dependencies, and install plain `seampact-drf` in production. Add `seampact-signed-webhooks` if a route is signed by a sender: `pip install --no-index --find-links ~/src/seampact/python/dist seampact-signed-webhooks`.

In `seampact.config.yaml`, add one entry per api:

```yaml
outDir: generated
openapi: none
sources:
  shop:
    git: { url: "https://git.example.com/shop-contract.git", tag: v1.0.0, directory: bundle }
    integrity: sha256-...
targets:
  - id: shop
    out: shop
    use: pypi:seampact-drf
    api: shop
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
# or
python manage.py seampact_generate
```

The code goes into `generated/shop/`. Commit it. `seampact check` fails CI when it drifts from the contract.

Options of the entry (all optional), set under `options:`:

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses DRF's own field arguments (`min_length`, `max_length`, `min_value`, `max_value`). `seampact-consistent` gives the contract's exact checks, equal on every target. |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

Also on the entry: `mount` (a path prefix), `frameworkRoutes` (see [The boot check](#the-boot-check)), `allowUntested`, and under `artefacts`: `routeHelpers` and `bootCheck`. The other options are refused by name, see [Limits](#limits).

## Wire it in

Two files of your Django project.

```python
# settings.py
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "seampact.django",
]

MIDDLEWARE = [
    "generated.shop.django.ShopBoundary",
    "django.middleware.common.CommonMiddleware",
]

SEAMPACT = {
    "shop": {
        "handlers": {"products": "shop.api.products_handlers"},
        "authenticate": {"user": "shop.hooks.user_hook"},
        "deciders": {"products.update": "shop.hooks.product_decider"},
        "scope_resolvers": {"store": "shop.hooks.store_resolver"},
        "on_unexpected_error": "shop.hooks.unexpected_errors",
    },
}
```

```python
# urls.py
urlpatterns = [
    path("", include("generated.shop.urls")),
    path("admin/", admin.site.urls),
]
```

- The boundary goes first in `MIDDLEWARE`. Another seampact boundary may sit before it, for a second api.
- `handlers` has one entry per resource. `authenticate` has one per identity, `deciders` one per right or rule, `scope_resolvers` one per scope. Keys are the contract's names. Values are dotted paths to a factory.
- A factory is called once per request with the Django `HttpRequest`. Its return value is your handler class or hook object.
- Other keys: `idempotency_store`, `public_origin`, `responses`, and `operations` (per operation, `responses`). A key that is not listed is refused at boot. Add `public_origin` (`https://api.example.com`) when the contract writes absolute URLs.
- Include the patterns at `""`, outside any `include()` prefix and `i18n_patterns()`. To serve the api under a prefix, set `mount` on the entry.
- With two apis, add two boundaries, two includes and two keys of `SEAMPACT`.

Each route is named `seampact.<api>.<operationId>` after the first operation of its path. `ShopRouteNames` and `ShopUrls` build the names and the paths. `artefacts: { routeHelpers: false }` leaves both out.

A path segment that mixes a parameter with text, or holds `{`, `}` or `?`, is refused by `generate` (`path.segment.mixed.unsupported`, `path.segment.literal.unsupported`).

A trailing slash on a contract path answers the contract's 404, so `APPEND_SLASH` never redirects a contract request.

## Write a handler

Write one class per resource. It implements the generated `<Resource>Endpoints` protocol. A factory builds it from the request:

```python
from django.http import HttpRequest
from generated.shop.operations import GetProductErrors, GetProductRequest, GetProductResponse200, GetProductResult


class ProductsHandlers:
    def __init__(self, request: HttpRequest) -> None:
        self.request = request

    def get_product(self, request: GetProductRequest) -> GetProductResult:
        product = Product.objects.filter(pk=request.input.path.product_id).first()

        if product is None:
            return GetProductErrors.api_not_found()

        return GetProductResponse200(body=to_contract(product))


def products_handlers(request: HttpRequest) -> ProductsHandlers:
    return ProductsHandlers(request)
```

- Handlers and hooks are plain `def`. An `async def` method is refused at boot, naming the method.
- `request.input` holds the checked path, query, headers and body as frozen dataclasses. Your ORM models never leave the boundary: map them to the contract's type, as above.
- You never write a status or a content type. Return one arm of the result (`GetProductResponse200`), or an error (`GetProductErrors.api_not_found()`). You can raise the same error instead.
- A reply that breaks the contract answers 500. So does any other exception, and `on_unexpected_error` hears it. With `ATOMIC_REQUESTS`, a contract error rolls the transaction back, as DRF's own handler does.

When an operation takes a version, the boundary checks its format only. Compare it with the stored version yourself, and return the operation's conflict error when they differ:

```python
if request.input.body.expected_version != product.version:
    return UpdateProductErrors.state_conflict()
```

A deadline is a declared header. `request.deadline` is `None` when the caller sent none. Check `request.deadline.has_passed(datetime.now(UTC))` while you work, and answer the operation's deadline error (`GetProductErrors.api_deadline_exceeded()`). `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, `request.principal` is the caller, typed as the generated `<Identity>Principal`. It is `None` for an anonymous caller on an optional-auth route. A public route has no `principal`.

When the route runs in scopes, `request.scopes` has one attribute per scope, each the `ResolvedScope` your resolver returned, with its `id` and `value`:

```python
store = request.scopes.store.value
user_id = request.principal.user_id
```

Neither is part of the input, and the client cannot set them. Both print as `[redacted]`.

## Write the hooks

A hook is a class. Its factory takes the `HttpRequest`, so a hook can read `request.user`, which DRF sets. Name an authentication class in `access` (see "access" below), or `request.user` is anonymous.

```python
from seampact.hooks import AuthenticateRequest, AuthenticateResult, ErrorCodeWithParams, authenticate_result


class UserHook:
    def __init__(self, drf_user: object) -> None:
        self.drf_user = drf_user

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        if not getattr(self.drf_user, "is_authenticated", False):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code="api.unauthenticated"))

        return authenticate_result.Authenticated(principal=UserPrincipal(user_id=self.drf_user.pk))


def user_hook(request: HttpRequest) -> UserHook:
    return UserHook(getattr(request, "user", None))
```

- A decider has `decide(request)` and returns `decision.Allowed()` or `decision.Denied(deny=ErrorCodeWithParams(code=...))`. A scope resolver has `resolve_scope(request)` and returns `scope_resolution.Resolved(resolved=ResolvedScope(...))` or `scope_resolution.Denied(deny=...)`. They come from `seampact.hooks`. The `params` of a right or rule in the request is an instance of its generated params class (a frozen dataclass), not a dict: for a right declared with `params: { allowed: [...] }`, read `request.params.allowed`.
- An idempotency store has `begin`, `complete` and `abandon` (`seampact.hooks.IdempotencyStore`). Name its factory in `idempotency_store`. Use it when an operation is idempotent. With the ORM, it runs in the thread of the sync views, also under ASGI.
- The unexpected-error listener has `on_unexpected_error(failure)`. It hears each 500 the api answers.
- To verify a signed webhook, call `seampact-signed-webhooks` in the authenticate hook. The raw body is `request.signature.raw_body`; `request.signature` is `None` on an unsigned route. `TemplateSignatureVerifier` checks a template signature. A signature your application verifies is refused (`signature.application.unsupported`).

## DRF's own auth

DRF's authentication, permission and throttle classes work beside the contract. The app's `DEFAULT_PERMISSION_CLASSES` and the like never apply to a contract route, so a global `IsAuthenticated` never refuses a public operation. Name the classes a kind of route uses in `access`, by DRF's own keys:

```python
SEAMPACT = {
    "shop": {
        # ...
        "access": {
            "identity": {
                "authentication_classes": ["rest_framework.authentication.SessionAuthentication"],
                "throttle_classes": ["shop.throttles.UserBurstThrottle"],
            },
        },
    },
}
```

- The kinds are `public`, `optional`, `identity` and `signed`. The keys are `authentication_classes`, `permission_classes` and `throttle_classes`, with dotted paths. A kind with no entry runs none.
- DRF replaces `request.user` with its anonymous user on a kind that has no authentication class. Name `SessionAuthentication`, or your own class, for the kinds where your hook reads the user.
- `NotAuthenticated` and `AuthenticationFailed` answer the contract's `unauthenticated` error. `PermissionDenied` answers `forbidden`, `NotFound` and `Http404` `notFound`, and `Throttled` `rateLimited` with its `Retry-After`. The CSRF failure of `SessionAuthentication` answers `csrfInvalid`.
- Any other `APIException` answers the contract's error of its status. Without that error, the operation's one code of that status answers, if it has exactly one. Otherwise the reply is a logged 500.
- Your `EXCEPTION_HANDLER` never runs on a contract route. It keeps running on yours.
- DRF adds no `Allow` or `Vary` header and never answers 406 on a contract route. Its schema generator skips the views.

DRF has no document of its own that seampact switches, so there is no `nativeDocs`: `artefacts.unknown` refuses the key. `frameworkDocs: off` is refused (`config.frameworkDocs.unsupported`): remove your own schema view instead.

## Test your routes

Go through the boundary with Django's test `Client`:

```python
def test_get_product(client):
    reply = client.get("/v1/products/p-1", headers={"Authorization": "Bearer test-token"})

    assert reply.status_code == 200
```

- Send the credential the contract requires, and point `SEAMPACT` in your test settings module at fake hooks.
- Never use `override_settings(MIDDLEWARE=...)` without the boundary, or call a view with `APIRequestFactory`. The generated view fails closed: it answers the api's 500 with no input read.
- To call a handler directly, build its request class from `generated.shop.operations` yourself. That request skips the boundary, so use it for unit tests only.
- `python manage.py seampact_check` runs the boot check without a server. Run it in CI.

## The boot check

The app refuses to start, and lists every problem, when:

- an identity has no authenticate hook, a right or rule no decider, a scope no resolver, an idempotent operation no store;
- an operation has no handler, or its route is missing or included twice;
- a pattern of yours would take a contract request, or sits under the api's base path and `frameworkRoutes` does not allow-list it;
- the boundary is not first in `MIDDLEWARE`, or the api's patterns are in the URLconf without it;
- `DATA_UPLOAD_MAX_MEMORY_SIZE` is below the contract's largest body limit;
- the contract writes absolute URLs and `public_origin` is missing, or it writes relative URLs and it is set;
- `access` names an unknown kind, or a class DRF cannot use;
- a handler or a hook is `async def`;
- the Django or DRF major is not one that `generate` accepted.

It runs when the server loads the app (gunicorn stops with `Worker failed to boot.`), and as a Django system check on `check`, `runserver`, `migrate` and `test`. A system check only warns, so `migrate` still runs on a broken app. Each message names the fix; find it in [Boot errors](../troubleshooting/boot.md#django-drf).

Allow-list your own routes in the entry, with a reason:

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Django admin, not part of the api." }
```

`artefacts: { bootCheck: false }` turns the check off. `{ frameworkRoutes: false }` turns off its route part, and `{ hooks: off }` its hook part. `hooks` takes `error` (default) or `off`; `warn` is refused (`artefacts.bootCheck.hooks.warn.unsupported`).

## Versions

Django 5.2 and 6, and DRF 3.18, are tested. An older version fails with `config.matrix.incompatible`. A tested major with a minor that is not tested prints `config.matrix.untested-minor` (an error under `checks: { matrix: error }`), and the boot logs one warning. A major outside the matrix prints `config.matrix.untested`. Accept it with `allowUntested: [django@7]` on the entry, or the boot check refuses it.

## Limits

- Serve with gunicorn or uvicorn. `runserver` gives no raw request path, so the boundary matches the decoded path and logs which rules it cannot apply. A chunked request with no `Content-Length` is refused with 400 under a WSGI server that does not mark its input as terminated, and `runserver` is one.
- Under ASGI, Django reads the whole body before the first middleware. Bound it at your proxy or server.
- A WSGI or ASGI wrapper around the application object (an error tracker, `WhiteNoise(application)`) runs before the boundary and is not seen.
- A middleware before the boundary in `MIDDLEWARE` is refused at boot.
- `generate` refuses by name: form, multipart, file, download and redirect bodies, query lists in every form (`tag=a&tag=b`, `tag=a,b` or `tag[]=a`), `oneOf` unions, `handlers: perOperation`, `indent` other than 4, the naming options and `layout`, `accessHooks: false`, and a link on the entry. See [Target option errors](../troubleshooting/generate.md).
- `bodyValidation` (and `body_validation` in `SEAMPACT`) is not served on DRF yet: the boot check refuses it. Use FastAPI for it.
- Django REST Framework older than 3.18 and Django older than 5.2 are refused.
- FastAPI is a separate target: see [FastAPI](fastapi.md).

## Versioned writes and query lists

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

A query list is refused by `generate` for now, in the `repeat` and `comma` forms alike (`param.query.structured.unsupported`). Use a scalar param, or leave the operation out of the entry's `operations` filter.

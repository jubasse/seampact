# Django REST Framework

`seampact-drf` generates the contract's Python code for Django REST Framework. You write the handlers and the hooks; the generated boundary checks each request and each reply.

Django 5.2 or 6, and DRF 3.18, on Python 3.12 or later. See [Versions](#versions) and [Supported versions](../supported-versions.md).

## Set up

You need:

- Python 3.12 or later;
- Django 5.2 or 6;
- DRF 3.18. Pydantic is not needed.

Install seampact from PyPI. Put the generator in your dev dependencies and the runtime in production:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-drf[generate]"
```

`uv pip install` and `uv add --dev` take the same requirement. In production, install plain `seampact-drf`. Add `seampact-signed-webhooks` if a route is signed by a sender.

A `path` source and the OpenAPI documents need the compiler. Add the extra `seampact-ir[compiler]`, which installs the `seampact-compiler` wheel for your platform. A bundle-only app with `openapi: none` does not need it.

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

Then generate:

```sh
seampact generate
# or
python manage.py seampact_generate
```

The code goes into `generated/shop/`. Commit it. `seampact check` fails CI when it drifts from the contract.

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

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

A deadline is a declared header. `request.deadline` is `None` when the caller sent none. Check `request.deadline.has_passed(datetime.now(UTC))` while you work, and answer the operation's deadline error (`GetProductErrors.api_deadline_exceeded()`). `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, `request.principal` is the caller, typed as the generated `<Identity>Principal`. It is `None` for an anonymous caller on an optional-auth route. A public route has no `principal`.

When the route runs in scopes, `request.scopes` has one attribute per scope, each the `ResolvedScope` your resolver returned, with its `id` and `value`:

```python
store = request.scopes.store.value
user_id = request.principal.user_id
```

Neither is part of the input, and the client cannot set them. Both print as `[redacted]`.

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
- Other keys: `idempotency_store`, `public_origin`, `responses`, `access` and `operations` (per operation, `responses`). A key that is not listed is refused at boot.
- Include the patterns at `""`, outside any `include()` prefix and `i18n_patterns()`. To serve the api under a prefix, set `mount` on the entry.
- With two apis, add two boundaries, two includes and two keys of `SEAMPACT`.

Each route is named `seampact.<api>.<operationId>` after the first operation of its path. `ShopRouteNames` and `ShopUrls` build the names and the paths. `artefacts: { routeHelpers: false }` leaves both out.

A trailing slash on a contract path answers the contract's 404, so `APPEND_SLASH` never redirects a contract request.

## Write the hooks

A hook is a class. Its factory takes the `HttpRequest`, so a hook can read `request.user`, which DRF sets. Name an authentication class in `access` (see [Use DRF's own auth](#use-drfs-own-auth)), or `request.user` is anonymous.

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

- A decider has `decide(request)` and returns `decision.Allowed()` or `decision.Denied(deny=ErrorCodeWithParams(code=...))`.
- A scope resolver has `resolve_scope(request)` and returns `scope_resolution.Resolved(resolved=ResolvedScope(...))` or `scope_resolution.Denied(deny=...)`.
- They come from `seampact.hooks`. The `params` of a right or rule in the request is an instance of its generated params class (a frozen dataclass), not a dict: for a right declared with `params: { allowed: [...] }`, read `request.params.allowed`.
- An idempotency store has `begin`, `complete` and `abandon` (`seampact.hooks.IdempotencyStore`). Name its factory in `idempotency_store`. An idempotent operation needs one. With the ORM, it runs in the thread of the sync views, also under ASGI.
- The unexpected-error listener has `on_unexpected_error(failure)`. It hears each 500 the api answers.
- To verify a signed webhook, call `seampact-signed-webhooks` in the authenticate hook. The raw body is `request.signature.raw_body`; `request.signature` is `None` on an unsigned route. `TemplateSignatureVerifier` checks a template signature. A signature your application verifies is refused (`signature.application.unsupported`).

### Use DRF's own auth

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

## Options

Set under `options:` on the target entry.

| Option | Default | What it does |
|---|---|---|
| `rules` | `native` | `native` uses DRF's own field arguments (`min_length`, `max_length`, `min_value`, `max_value`). `seampact-consistent` gives the contract's exact checks, equal on every target. |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

Also on the entry: `mount` (a path prefix), `frameworkRoutes` (see [The boot check](#the-boot-check)), `allowUntested`, and under `artefacts`: `routeHelpers` and `bootCheck`. The full list is in the [configuration reference](../configuration/reference.md#seampact-drf).

`bodyValidation` (and `body_validation` in `SEAMPACT`) is not served on DRF: the boot check refuses it. Use FastAPI for it.

## Docs and OpenAPI

DRF has no document of its own that seampact switches, so there is no `nativeDocs`: `artefacts.unknown` refuses the key. `frameworkDocs: off` is refused (`config.frameworkDocs.unsupported`): remove your own schema view instead. See [OpenAPI and docs](../configuration/openapi-and-docs.md).

## Test your routes

Go through the boundary with Django's test `Client`:

```python
def test_get_product(client):
    reply = client.get("/v1/products/p-1", headers={"Authorization": "Bearer test-token"})

    assert reply.status_code == 200
```

- Send the credential the contract requires, and point `SEAMPACT` in your test settings module at fake hooks.
- Never use `override_settings(MIDDLEWARE=...)` without the boundary, or call a view with `APIRequestFactory`. The generated view fails closed: it answers the api's 500 with no input read.
- `python manage.py seampact_check` runs the boot check without a server. Run it in CI.

To call a handler directly, build its request class from `generated.shop.operations` yourself. That request skips the boundary, so use it for unit tests only.

### Debug locally

With `DEBUG = True`, an exception that no contract error maps shows Django's debug page. With `DEBUG = False`, the client gets the api's 500, and the log names the exception's class and where it was raised, never its message.

A reply that breaks the contract is still a 500. To see it while you work, set `"responses": "warn"` in your local `SEAMPACT` settings: the reply goes out and the log names the problem.

## Deploy

- Serve with gunicorn or uvicorn. `runserver` gives no raw request path, so the boundary matches the decoded path and logs which rules it cannot apply. A chunked request with no `Content-Length` is refused with 400 under a WSGI server that does not mark its input as terminated, and `runserver` is one.
- Under ASGI, Django reads the whole body before the first middleware. Bound it at your proxy or server.
- To serve the api under a prefix, set `mount` on the entry. Page links add the WSGI `SCRIPT_NAME` or the ASGI `root_path` to the contract path, so set it when a proxy strips a prefix before the app.
- When the contract writes absolute URLs, set `public_origin` in `SEAMPACT`. The request's `Host` is never read.
- Set `DATA_UPLOAD_MAX_MEMORY_SIZE` to at least the contract's largest body limit.
- A WSGI or ASGI wrapper around the application object (an error tracker, `WhiteNoise(application)`) runs before the boundary and is not seen. A middleware before the boundary in `MIDDLEWARE` is refused at boot.

In Docker, install plain `seampact-drf`. The generated code is committed, so the image needs no compiler.

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
CMD ["gunicorn", "shop.wsgi", "--bind", "0.0.0.0:8000"]
```

Read secrets and the public origin from environment variables in `settings.py`. Never bake them into the image.

### The boot check

The app refuses to start, and lists every problem. It runs when the server loads the app (gunicorn stops with `Worker failed to boot.`), and as a Django system check on `check`, `runserver`, `migrate` and `test`. A system check only warns, so `migrate` still runs on a broken app: run `python manage.py seampact_check` in CI. Each message names the fix; find it in [Boot errors](../troubleshooting/boot.md#django-drf).

| Fault | Fix |
|---|---|
| An identity has no authenticate hook, a right or rule no decider, a scope no resolver. | Add its entry to `SEAMPACT`. |
| An idempotent operation has no store. | Set `idempotency_store`. |
| An operation has no handler, or its route is missing or included twice. | Add the resource to `handlers`; include `generated.shop.urls` once. |
| A pattern of yours would take a contract request, or sits under the api's base path and `frameworkRoutes` does not allow-list it. | Move it, or allow-list it. |
| The boundary is not first in `MIDDLEWARE`, or the api's patterns are in the URLconf without it. | Put it first. |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` is below the contract's largest body limit. | Raise it. |
| The contract writes absolute URLs and `public_origin` is missing, or it writes relative URLs and it is set. | Set it, or remove it. |
| `access` names an unknown kind, or a class DRF cannot use. | Use `public`, `optional`, `identity` or `signed`, and a DRF class. |
| A handler or a hook is `async def`. | Make it a plain `def`. |
| The Django or DRF major is not one that `generate` accepted. | Run `seampact generate` again, or accept it with `allowUntested`. |

Allow-list your own routes in the entry, with a reason:

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Django admin, not part of the api." }
```

`artefacts: { bootCheck: false }` turns the check off. `{ frameworkRoutes: false }` turns off its route part, and `{ hooks: off }` its hook part. `hooks` takes `error` (default) or `off`; `warn` is refused (`artefacts.bootCheck.hooks.warn.unsupported`).

## Versions

Django 5.2 and 6, and DRF 3.18, are tested. An older version fails with `config.matrix.incompatible`. A tested major with a minor that is not tested prints `config.matrix.untested-minor` (an error under `checks: { matrix: error }`), and the boot logs one warning. A major outside the matrix prints `config.matrix.untested`. Accept it with `allowUntested: [django@7]` on the entry, or the boot check refuses it.

## Limits

- `generate` refuses some forms by name, until an app needs them. The list is in [Generate errors](../troubleshooting/generate.md#python); forms refused on every server are under [every server](../troubleshooting/generate.md#every-server).
- A sort key restricted by a right is refused (`paging.sortKey.right.unsupported`). A query list is read in the default `repeat` form (`tag=a&tag=b`) or as `comma`.
- FastAPI and Ninja are separate targets: see [FastAPI](fastapi.md) and [Django Ninja](ninja.md).

## Next

- [Call the api from React](../frontend/react.md)
- [Check the generated code in CI](../features/check-in-ci.md)

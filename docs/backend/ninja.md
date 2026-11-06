# Write the handlers (Django Ninja)

`seampact-ninja` generates the contract's Python code for Django Ninja. You write the handlers and the hooks; the generated boundary checks each request and each reply.

## Set up

Python 3.12 or later, Django 5.2 or 6, Django Ninja 1.5.3 or later, and Pydantic 2. Pydantic 1 is refused. CI runs the oldest of each (Django 5.2, Ninja 1.5.3) and the latest.

Install seampact from PyPI. Put the generator in your dev dependencies and the runtime in production:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-ninja[generate]"
```

`uv pip install` and `uv add --dev` take the same requirement. In production, install plain `seampact-ninja`. Add `seampact-signed-webhooks` if a route is signed by a sender: `pip install seampact-signed-webhooks`.

Working from a checkout of the repository instead? See [Install](../getting-started/01-install.md#from-a-checkout).

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
    use: pypi:seampact-ninja
    api: shop
    options: { views: sync }
```

A `path` source and the OpenAPI documents need the compiler binary. It comes with `seampact-ir`, as the `seampact-compiler` wheel for your platform. Nothing else to install.

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
| `views` | `sync` | `sync` views run your handlers and hooks as plain `def`. `async` views take `async def` too. |
| `rules` | `native` | `native` uses Pydantic's own value rules. `seampact-consistent` gives the contract's exact checks, equal on every target. |
| `responses` | `strict` | `strict` answers 500 when your reply breaks the contract. `warn` logs it and sends the reply. |
| `frameworkEtag` | `strip` | Drops an ETag or a 304 that the boundary did not write. `keep` leaves them. |
| `catchAll` | `true` | Unknown paths under the api's base path answer the contract's 404. |

Also on the entry: `mount` (a path prefix), `frameworkRoutes` (see [The boot check](#the-boot-check)), `frameworkDocs`, `allowUntested`, and under `artefacts`: `routeHelpers`, `nativeDocs` and `bootCheck`. The other options are refused by name, see [Limits](#limits).

## Wire it in

Three files of your Django project. Ninja takes the api's values from `bind_shop()`, not from `settings.SEAMPACT`.

```python
# settings.py
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "ninja",
    "seampact.django",
]

MIDDLEWARE = [
    "generated.shop.django.ShopBoundary",
    "django.middleware.common.CommonMiddleware",
]
```

```python
# api.py
from generated.shop.ninja import ShopHandlerFactories, bind_shop
from ninja import NinjaAPI

api = NinjaAPI(urls_namespace="shop")
bind_shop(
    api,
    prefix="",
    handlers=ShopHandlerFactories(products=products_handlers),
    authenticate={"user": user_hook},
    deciders={"products.update": product_decider},
    scope_resolvers={"store": store_resolver},
    on_unexpected_error=unexpected_errors,
)
```

```python
# urls.py
urlpatterns = [
    path("", api.urls),
    path("admin/", admin.site.urls),
]
```

- The boundary goes first in `MIDDLEWARE`. Another seampact boundary may sit before it, for a second api.
- `handlers` has one factory per resource. `authenticate` has one per identity, `deciders` one per right or rule, `scope_resolvers` one per scope. Keys are the contract's names.
- A factory is called once per request with the Django `HttpRequest`. Its return value is your handler class or hook object.
- Other arguments: `idempotency_store`, `access` (see [Ninja's own auth](#ninjas-own-auth)), `public_origin`, `responses`, and `operations` (per operation, `responses`). Add `public_origin` (`https://api.example.com`) when the contract writes absolute URLs.
- The prefix where you include `api.urls`, plus `prefix`, must equal the entry's `mount` (empty by default). The boot check refuses any other sum.
- With two apis, add two boundaries and call both `bind_` functions on the same `NinjaAPI`. Call each `bind_` function once per `NinjaAPI`: a second call raises.
- Leave `settings.SEAMPACT` without a key for the api: the boot check refuses one.

Each route is named `seampact.<api>.<operationId>`, under the `NinjaAPI`'s `urls_namespace`: reverse `"shop:" + ShopRouteNames.GET_PRODUCT`. `ShopRouteNames` and `ShopUrls` build the names and the paths. `artefacts: { routeHelpers: false }` leaves both out.

A path segment that mixes a parameter with text, or holds `{`, `}` or `?`, is refused by `generate` (`path.segment.mixed.unsupported`, `path.segment.literal.unsupported`).

A `GET` route answers `HEAD` too. A CORS preflight that no CORS layer answers gets the path's 404.

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

        return GetProductResponse200(to_contract(product))


def products_handlers(request: HttpRequest) -> ProductsHandlers:
    return ProductsHandlers(request)
```

- With `views: sync`, handlers and hooks are plain `def`. An `async def` method is refused at boot, naming the method.
- With `views: async`, a method is a `def` or an `async def`. A `def` runs through Django's `sync_to_async`.
- `request.input` holds the checked path, query, headers and body, typed. Your ORM models never leave the boundary: map them to the contract's type, as above.
- You never write a status or a content type. Return one arm of the result (`GetProductResponse200`), or an error (`GetProductErrors.api_not_found()`). You can raise the same error instead.
- A reply that breaks the contract answers 500. So does any other exception, and `on_unexpected_error` hears it.

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

A hook is a class. Its factory takes the `HttpRequest`, so a hook can read `request.auth`, which Ninja sets from the `auth=` you name in `access`.

```python
from seampact.hooks import AuthenticateRequest, AuthenticateResult, ErrorCodeWithParams, authenticate_result


class UserHook:
    def __init__(self, signed_in: object) -> None:
        self.signed_in = signed_in

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        if not isinstance(self.signed_in, User):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code="api.unauthenticated"))

        return authenticate_result.Authenticated(principal=UserPrincipal(user_id=self.signed_in.pk))


def user_hook(request: HttpRequest) -> UserHook:
    return UserHook(getattr(request, "auth", None))
```

- A decider has `decide(request)` and returns `decision.Allowed()` or `decision.Denied(deny=ErrorCodeWithParams(code=...))`. A scope resolver has `resolve_scope(request)` and returns `scope_resolution.Resolved(resolved=ResolvedScope(...))` or `scope_resolution.Denied(deny=...)`. They come from `seampact.hooks`. The `params` of a right or rule in the request is an instance of its generated params class (a Pydantic model), not a dict: for a right declared with `params: { allowed: [...] }`, read `request.params.allowed`.
- An idempotency store has `begin`, `complete` and `abandon` (`seampact.hooks.IdempotencyStore`). Pass its factory as `idempotency_store`. Use it when an operation is idempotent.
- The unexpected-error listener has `on_unexpected_error(failure)`. It hears each 500 the api answers.
- To verify a signed webhook, call `seampact-signed-webhooks` in the authenticate hook. The raw body is `request.signature.raw_body`; `request.signature` is `None` on an unsigned route. `TemplateSignatureVerifier` checks a template signature. A signature your application verifies is refused (`signature.application.unsupported`).

## Ninja's own auth

Ninja's `auth=` and throttles work beside the contract. An app-wide `NinjaAPI(auth=...)` never applies to a contract route, so it never refuses a public operation. Name what a kind of route uses in `access`:

```python
from ninja.security import django_auth
from ninja.throttling import AuthRateThrottle
from seampact.ninja.runtime import AccessSettings

bind_shop(
    api,
    # ...
    access={"identity": AccessSettings(auth=django_auth, throttle=[AuthRateThrottle("100/m")])},
)
```

- The kinds are `public`, `optional`, `identity` and `signed`. A kind with no entry runs no `auth=` and no throttle.
- Give a kind an `auth=` only when each of its operations declares an `unauthenticated` error, and a throttle only when each declares a `rateLimited` error. The boot check names the operation otherwise.
- Ninja refuses a request when every `auth=` callable returns a falsy value. Return a truthy value for a caller your hook should still see, such as a session-cookie caller.
- `AuthenticationError` answers the contract's `unauthenticated` error. `AuthorizationError` answers `forbidden`, `Http404` `notFound`, and `Throttled` `rateLimited` with its `Retry-After`. Any other `HttpError` answers the contract's error of its status.
- Without that error, the operation's one code of that status answers, if it has exactly one. Otherwise the reply is a logged 500.
- On a contract route, the contract's error replaces what your exception handlers render. Your own routes keep their reply.
- Outside `DEBUG`, any other exception from a handler answers the api's 500. The log names its class and where it was raised, never its message.
- If you replace `api.on_exception`, do it before `bind_shop()`: the boot check refuses it after.

## Docs

Ninja's `/docs` and `/openapi.json` show your own routes only. To add the contract's routes, set `nativeDocs` on the entry:

```yaml
    artefacts: { nativeDocs: true }
```

Each route then appears in Ninja's document as the contract describes it, at its path under `mount`. `generate` writes `native_docs.json` beside the code, and `bind_shop()` adds it to the document Ninja builds.

- `nativeDocs` needs the compiler binary, since it gets the document from it. Until 1.0, set `[tool.seampact.binary]` as shown in [Set up](#set-up).
- A contract schema whose name your document already holds with another value stops the app at boot, naming it.
- Run `seampact generate` again when the contract changes. A stale `native_docs.json` stops the app at boot.
- `frameworkDocs: off` is refused (`config.frameworkDocs.unsupported`): build your api with `NinjaAPI(docs_url=None, openapi_url=None)` instead.

More in [OpenAPI and docs](../configuration/openapi-and-docs.md).

## Test your routes

Go through the boundary with Django's test `Client`:

```python
def test_get_product(client):
    reply = client.get("/v1/products/p-1", headers={"Authorization": "Bearer test-token"})

    assert reply.status_code == 200
```

- Send the credential the contract requires. Build the `NinjaAPI` in a function that takes the hook factories, and pass fakes in the test.
- Never use Ninja's `TestClient`, or `override_settings(MIDDLEWARE=...)` without the boundary. They skip the boundary, and the generated view fails closed: it answers the api's 500 with no input read.
- To call a handler directly, build its request class from `generated.shop.operations` yourself. That request skips the boundary, so use it for unit tests only.
- `python manage.py seampact_check` runs the boot check without a server. Run it in CI.

## The boot check

The app refuses to start, and lists every problem, when:

- the api is not bound, or `settings.SEAMPACT` has a key for it;
- an identity has no authenticate hook, a right or rule no decider, a scope no resolver, an idempotent operation no store;
- an operation has no handler, or its route is missing or included twice;
- a pattern of yours would take a contract request, or sits under the api's base path and `frameworkRoutes` does not allow-list it;
- the boundary is not first in `MIDDLEWARE`, or the api's patterns are in the URLconf without it;
- `DATA_UPLOAD_MAX_MEMORY_SIZE` is below the contract's largest body limit;
- the contract writes absolute URLs and `public_origin` is missing, or it writes relative URLs and it is set;
- `access` names an unknown kind, or a kind no operation has;
- `api.on_exception` was replaced after `bind_shop()`;
- with `views: sync`, a handler or a hook is `async def`;
- the Django or Ninja major is not one that `generate` accepted.

It runs when the server loads the app (gunicorn stops with `Worker failed to boot.`), and as a Django system check on `check`, `runserver`, `migrate` and `test`. A system check only warns, so `migrate` still runs on a broken app. Each message names the fix; find it in [Boot errors](../troubleshooting/boot.md#django-ninja).

Ninja's `/docs` and `/openapi.json` need no entry. Allow-list your own routes in the entry, with a reason:

```yaml
    frameworkRoutes:
      - { path: "/admin/**", reason: "Django admin, not part of the api." }
```

`artefacts: { bootCheck: false }` turns the check off. `{ frameworkRoutes: false }` turns off its route part, and `{ hooks: off }` its hook part. `hooks` takes `error` (default) or `off`; `warn` is refused (`artefacts.bootCheck.hooks.warn.unsupported`).

## Versions

Django 5.2 and 6, and Django Ninja 1.5 and 1.7, are tested. An older version fails with `config.matrix.incompatible`. A tested major with a minor that is not tested prints `config.matrix.untested-minor` (an error under `checks: { matrix: error }`), and the boot logs one warning. A major outside the matrix prints `config.matrix.untested`. Accept it with `allowUntested: [django-ninja@2]` on the entry, or the boot check refuses it.

## Limits

- Serve with gunicorn or uvicorn. `runserver` gives no raw request path, so the boundary matches the decoded path and logs which rules it cannot apply. A chunked request with no `Content-Length` is refused with 400 under a WSGI server that does not mark its input as terminated, and `runserver` is one.
- Under ASGI, Django reads the whole body before the first middleware. Bound it at your proxy or server.
- A WSGI or ASGI wrapper around the application object (an error tracker, `WhiteNoise(application)`) runs before the boundary and is not seen.
- A middleware before the boundary in `MIDDLEWARE` is refused at boot.
- `generate` refuses by name: form, multipart, file, download and redirect bodies, query lists in `brackets` form (`tag[]=a`), lists of lists and object query params, `oneOf` unions, `handlers: perOperation`, `indent` other than 4, the naming options and `layout`, `accessHooks: false`, an identity header written on a response (a `versionToken` header, or one declared `in: response`), and a link on the entry. See [Target option errors](../troubleshooting/generate.md).
- `bodyValidation` (and `body_validation` in `bind_shop()`) is not served on Ninja yet: the boot check refuses it. Use FastAPI for it.
- Django Ninja older than 1.5.3 and Django older than 5.2 are refused.
- DRF and FastAPI are separate targets: see [Django REST Framework](drf.md) and [FastAPI](fastapi.md).

## Versioned writes and query lists

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](../contract/07-advanced.md#catch-lost-updates).

A query list of scalars or enums is read in the default `repeat` form (`tag=a&tag=b`) or as `comma`. The `brackets` form and a list of lists are refused by `generate`.

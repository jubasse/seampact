<!-- Generated from docs/backend/drf.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Django REST Framework

Page: https://jubasse.github.io/seampact/backend/drf/

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

A write versioned with `header.If-Match` answers 428 when the header is missing or empty, before the handler runs. A weak tag (`W/"7"`) is accepted, and the handler receives the version unquoted (`7`). A stale version is a 412: the handler returns the `preconditionFailed` error. See [Catch lost updates](https://jubasse.github.io/seampact/contract/07-advanced/#catch-lost-updates).

A deadline is a declared header. `request.deadline` is `None` when the caller sent none. Check `request.deadline.has_passed(datetime.now(UTC))` while you work, and answer the operation's deadline error (`GetProductErrors.api_deadline_exceeded()`). `budgetMs` is the client's timeout; the boundary does not enforce it.

### Who is calling

On a route with an identity, `request.principal` is the caller, typed as the generated `<Identity>Principal`. It is `None` for an anonymous caller on an optional-auth route. A public route has no `principal`.

When the route runs in scopes, `request.scopes` has one attribute per scope, each the `ResolvedScope` your resolver returned, with its `id` and `value`:

```python
store = request.scopes.store.value
user_id = request.principal.user_id
```

Neither is part of the input, and the client cannot set them. Both print as `[redacted]`.

## Paging

A paged list reads `request.input.query.cursor` (`None` when absent) and `request.input.query.limit` for the `cursor` style. The boundary fills in `defaultLimit` and answers 400 to a limit above `maxLimit` (`overLimit: clamp` serves `maxLimit`). `query.limit` stays typed `int | None`: narrow it with `assert query.limit is not None`.

Return the generated `<Operation>Page`: `items`, plus one snake-case attribute per page fact (`next_cursor` for `nextCursor`). The boundary writes the body, the headers and the `Link` relations.

```python
def list_products(self, request: ListProductsRequest) -> ListProductsResult:
    query = request.input.query
    products, next_cursor = load_products_page(after=query.cursor, limit=query.limit)

    return ListProductsResponse200(body=ListProductsPage(items=[to_contract(product) for product in products], next_cursor=next_cursor))
```

Import `ListProductsPage` from `generated.shop.operations` with the other generated names. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

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

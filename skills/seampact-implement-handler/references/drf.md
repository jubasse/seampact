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

A paged list reads its page parameters in `request.input.query`: for the `cursor` style, `request.input.query.cursor` and `request.input.query.limit`. An absent cursor is `None`. When the client sends no limit, the boundary fills in the style's `defaultLimit`; a limit above `maxLimit` is a 400 before your handler runs.

Return the generated `<Operation>Page`. It holds `items`, the list of the contract's item type, and one attribute per page fact the style's response names, in snake case (`next_cursor` for the fact `nextCursor`). The boundary writes the body, the headers and the `Link` relations from them. Never build them yourself.

```python
def list_products(self, request: ListProductsRequest) -> ListProductsResult:
    query = request.input.query
    products, next_cursor = load_products_page(after=query.cursor, limit=query.limit)

    return ListProductsResponse200(body=ListProductsPage(items=[to_contract(product) for product in products], next_cursor=next_cursor))
```

Import `ListProductsPage` from `generated.shop.operations` with the other generated names. See [Lists](https://jubasse.github.io/seampact/contract/05-lists/).

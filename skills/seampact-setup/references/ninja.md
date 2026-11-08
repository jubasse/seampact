<!-- Generated from docs/backend/ninja.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Django Ninja

Page: https://jubasse.github.io/seampact/backend/ninja/

## Set up

You need:

- Python 3.12 or later;
- Django 5.2 or 6;
- Django Ninja 1.5.3 or later, and Pydantic 2. Pydantic 1 is refused.

Install seampact from PyPI. Put the generator in your dev dependencies and the runtime in production:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install "seampact-ninja[generate]"
```

`uv pip install` and `uv add --dev` take the same requirement. In production, install plain `seampact-ninja`. Add `seampact-signed-webhooks` if a route is signed by a sender.

A `path` source and the OpenAPI documents need the compiler. Add the extra `seampact-ir[compiler]`, which installs the `seampact-compiler` wheel for your platform. A bundle-only app with `openapi: none` does not need it.

In `seampact.config.yaml`, add one entry per api. Replace the `git` url, the tag and `integrity` with your contract's: `integrity` is the hash `seampact bundle` printed when you published it (see [Share contracts](https://jubasse.github.io/seampact/features/sharing-contracts/)). To try a contract in a local folder, use `path: ./contract` instead and install the compiler extra above.

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

The request is checked by [Pydantic](https://jubasse.github.io/seampact/types-and-validation/pydantic/) models; see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

Then generate:

```sh
seampact generate
# or
python manage.py seampact_generate
```

The code goes into `generated/shop/`. Commit it ([Generated files](https://jubasse.github.io/seampact/configuration/config-file/#generated-files)). `seampact check` fails CI when it drifts from the contract; [Commands per stack](https://jubasse.github.io/seampact/features/commands-per-stack/) shows how to run it.

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
- Other arguments: `idempotency_store`, `access` (see [Use Ninja's own auth](https://jubasse.github.io/seampact/backend/ninja/#use-ninjas-own-auth)), `public_origin`, `responses`, and `operations` (per operation, `responses`).
- The prefix where you include `api.urls`, plus `prefix`, must equal the entry's `mount` (empty by default). The boot check refuses any other sum.
- With two apis, add two boundaries and call both `bind_` functions on the same `NinjaAPI`. Call each `bind_` function once per `NinjaAPI`: a second call raises.
- Leave `settings.SEAMPACT` without a key for the api: the boot check refuses one.

Each route is named `seampact.<api>.<operationId>`, under the `NinjaAPI`'s `urls_namespace`: reverse `"shop:" + ShopRouteNames.GET_PRODUCT`. `ShopRouteNames` and `ShopUrls` build the names and the paths. `artefacts: { routeHelpers: false }` leaves both out.

A `GET` route answers `HEAD` too. A CORS preflight that no CORS layer answers gets the path's 404.

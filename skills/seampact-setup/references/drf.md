<!-- Generated from docs/backend/drf.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Django REST Framework

Page: https://jubasse.github.io/seampact/backend/drf/

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

The code goes into `generated/shop/`. Commit it ([Generated files](https://jubasse.github.io/seampact/configuration/config-file/#generated-files)). `seampact check` fails CI when it drifts from the contract; [Commands per stack](https://jubasse.github.io/seampact/features/commands-per-stack/) shows how to run it.

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

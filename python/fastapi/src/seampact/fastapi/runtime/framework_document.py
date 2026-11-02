"""FastAPI's own OpenAPI document beside the contract (ADR 0026 "Native docs"). With `nativeDocs`, the contract routes
join `app.openapi()` with seampact's operation objects, each at seampact's path under the entry's `mount`, and
seampact's components beside the app's; a component the app's document already holds with another value is refused,
naming it. With `frameworkDocs: off`, the app serves none of FastAPI's documentation routes."""

import copy
from collections.abc import Callable, Sequence
from typing import Final

import fastapi

from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.native_docs import JsonObject, NativeDocs, NativeDocsError, json_object
from seampact.fastapi.runtime.placement import OperationRoute

_COMPONENTS: Final = "components"


def switch_framework_docs_off(app: fastapi.FastAPI) -> None:
    """Removes FastAPI's document and documentation pages from the app, as `FastAPI(openapi_url=None)` does."""
    urls = {app.openapi_url, app.docs_url, app.redoc_url, app.swagger_ui_oauth2_redirect_url} - {None}
    app.router.routes = [route for route in app.router.routes if getattr(route, "path", None) not in urls]
    app.openapi_url = None
    app.docs_url = None
    app.redoc_url = None
    app.swagger_ui_oauth2_redirect_url = None


def complete_framework_document(binding: ApiBinding, native_docs: NativeDocs) -> None:
    """Wraps `app.openapi()` so the document it builds, then caches, holds the api's contract routes."""
    app = binding.app
    previous: Callable[[], JsonObject] = app.openapi

    def openapi() -> JsonObject:
        if app.openapi_schema:
            return app.openapi_schema

        document = copy.deepcopy(previous())
        _add_operations(document, binding.placement.routes, binding.placement.mount, native_docs)
        _add_components(document, native_docs, binding.api)
        app.openapi_schema = document

        return document

    # FastAPI's documentation routes call `app.openapi()`; an app replaces it this way too.
    setattr(app, "openapi", openapi)  # noqa: B010


def _add_operations(
    document: JsonObject, routes: Sequence[OperationRoute], mount: str, native_docs: NativeDocs
) -> None:
    """Each contract route at seampact's path under the entry's `mount`, with the contract's parameter names."""
    paths = _member(document, "paths")

    for route in routes:
        native = native_docs.operations.get(route.operation_id)

        if native is not None:
            _member(paths, mount.rstrip("/") + native.path)[native.method] = copy.deepcopy(native.operation)


def _add_components(document: JsonObject, native_docs: NativeDocs, api: str) -> None:
    components = _member(document, _COMPONENTS)

    for kind, named in native_docs.components.items():
        held = _member(components, kind)

        for name, value in named.items():
            if name in held and held[name] != value:
                raise NativeDocsError(
                    f"seampact: FastAPI's document already holds the component {kind} '{name}', and api '{api}' "
                    "declares another one under that name. Rename the app's model, or switch `nativeDocs` off."
                )

            held[name] = copy.deepcopy(value)


def _member(document: JsonObject, key: str) -> JsonObject:
    """The object `document` holds at `key`, added empty when absent."""
    return json_object(document.setdefault(key, {}), key)

"""FastAPI's own OpenAPI document beside the contract (ADR 0026 "Native docs"). With `nativeDocs`, the contract routes
join `app.openapi()` with seampact's operation objects, each at seampact's path under the entry's `mount`, and
seampact's components beside the app's; a component the app's document already holds with another value is refused,
naming it. With `frameworkDocs: off`, the app serves none of FastAPI's documentation routes."""

import copy
from collections.abc import Callable
from typing import Final

import fastapi

from seampact.codegen.runtime.native_docs import (
    DocumentJoin,
    JsonObject,
    NativeDocs,
    add_native_docs,
    require_every_operation,
)
from seampact.fastapi.runtime.api_binding import ApiBinding

_FRAMEWORK: Final = "FastAPI"


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
    operation_ids = [route.operation_id for route in binding.placement.routes]
    require_every_operation(operation_ids, native_docs)
    previous: Callable[[], JsonObject] = app.openapi

    def openapi() -> JsonObject:
        if app.openapi_schema:
            return app.openapi_schema

        document = copy.deepcopy(previous())
        add_native_docs(
            document, operation_ids, binding.placement.mount, native_docs, DocumentJoin(_FRAMEWORK, binding.api)
        )
        app.openapi_schema = document

        return document

    # FastAPI's documentation routes call `app.openapi()`; an app replaces it this way too.
    setattr(app, "openapi", openapi)  # noqa: B010

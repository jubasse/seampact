"""Django Ninja's own OpenAPI document beside the contract (ADR 0026 "Native docs", ADR 0027 "Ninja"): with
`nativeDocs`, the contract routes, which the api's Router keeps out of Ninja's schema, join the document
`NinjaAPI.get_openapi_schema()` builds with seampact's operation objects and components."""

from collections.abc import Callable
from typing import Final

from ninja import NinjaAPI

from seampact.codegen.runtime.native_docs import (
    DocumentJoin,
    JsonObject,
    NativeDocs,
    add_native_docs,
    require_every_operation,
)
from seampact.ninja.runtime.placement import ApiPlacement

_FRAMEWORK: Final = "Django Ninja"


def complete_ninja_document(api: NinjaAPI, placement: ApiPlacement, native_docs: NativeDocs) -> None:
    """Wraps `api.get_openapi_schema()`, which Ninja's documentation routes call, so each document it builds holds
    the api's contract routes."""
    operation_ids = [route.operation_id for route in placement.routes]
    require_every_operation(operation_ids, native_docs)
    previous: Callable[..., JsonObject] = api.get_openapi_schema
    joined = DocumentJoin(_FRAMEWORK, placement.api)

    def get_openapi_schema(*arguments: object, **keywords: object) -> JsonObject:
        document = previous(*arguments, **keywords)
        add_native_docs(document, operation_ids, placement.mount, native_docs, joined)

        return document

    setattr(api, "get_openapi_schema", get_openapi_schema)  # noqa: B010

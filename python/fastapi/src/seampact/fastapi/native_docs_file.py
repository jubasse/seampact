"""`native_docs.json`, which `nativeDocs` adds beside the placement (ADR 0026 "Native docs"): the operation object of
each kept operation, taken by its `operationId` from the seampact OpenAPI document the runner hands the generator,
with the path and method it sits under, and the document's components. The runtime places each object at that path
under the entry's `mount` in FastAPI's document."""

import json
from collections.abc import Mapping
from typing import Final

from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.config.json_value import JsonObject, JsonValue
from seampact.ir.run.generator import NativeDocsDocument
from seampact.ir.write import GeneratedFile

NATIVE_DOCS_FILE: Final = "native_docs.json"
_HTTP_METHODS: Final = ("get", "put", "post", "delete", "options", "head", "patch", "trace")
_AT: Final = IrPlace("/artefacts/nativeDocs")


def native_docs_file(
    native_docs: NativeDocsDocument | None, kept_operations: Mapping[str, object], refusals: Refusals
) -> GeneratedFile | None:
    """None, with a refusal, when the runner handed no document or the document lacks a kept operation."""
    if native_docs is None:
        refusals.add(
            "artefacts.nativeDocs.document-missing",
            "The runner handed the fastapi target no seampact OpenAPI document, which 'nativeDocs: true' needs.",
            "Update seampact-ir to the release of seampact-fastapi, whose runner hands the document.",
            _AT,
        )
        return None

    found = _operations_by_id(native_docs.document)
    missing = [operation_id for operation_id in kept_operations if operation_id not in found]

    if missing:
        refusals.add(
            "artefacts.nativeDocs.operation-missing",
            f"The seampact OpenAPI document '{native_docs.name or '(the api)'}' holds no operation "
            f"'{"', '".join(missing)}', which the entry generates.",
            "Set the entry's `document` to a document that holds every operation it generates, or switch "
            "'nativeDocs' off.",
            _AT,
        )
        return None

    components = native_docs.document.get("components")
    content = {
        "operations": {operation_id: found[operation_id] for operation_id in kept_operations},
        "components": components if isinstance(components, dict) else {},
    }

    return GeneratedFile(NATIVE_DOCS_FILE, json.dumps(content, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def _operations_by_id(document: JsonObject) -> dict[str, JsonValue]:
    """Each operation object of the document's `paths`, by its `operationId`, with its path and method."""
    paths = document.get("paths")
    found: dict[str, JsonValue] = {}

    for path, item in (paths if isinstance(paths, dict) else {}).items():
        if not isinstance(item, dict):
            continue

        for method in _HTTP_METHODS:
            operation = item.get(method)
            operation_id = operation.get("operationId") if isinstance(operation, dict) else None

            if isinstance(operation_id, str):
                found[operation_id] = {"path": path, "method": method, "operation": operation}

    return found

"""`native_docs.json`, which `nativeDocs` adds beside the placement (ADR 0026 "Native docs"): the operation object of
each kept operation, taken by its `operationId` from the seampact OpenAPI document the runner hands the generator,
with the path and method it sits under, and the document's components those operations reach. The runtime places each
object at that path under the entry's `mount` in the framework's own document (FastAPI's, Django Ninja's)."""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.config.json_value import JsonObject, JsonValue
from seampact.ir.run.generator import NativeDocsDocument
from seampact.ir.write import GeneratedFile

NATIVE_DOCS_FILE: Final = "native_docs.json"
_HTTP_METHODS: Final = ("get", "put", "post", "delete", "options", "head", "patch", "trace")
_AT: Final = IrPlace("/artefacts/nativeDocs")
_COMPONENTS: Final = "components"
_REF: Final = "$ref"
_COMPONENT_REF_PREFIX: Final = "#/components/"
_SECURITY: Final = "security"
_SECURITY_SCHEMES: Final = "securitySchemes"


@dataclass(frozen=True, slots=True)
class FrameworkDocument:
    """The target whose framework document the operations join, its framework's name, and the schema names that
    document always holds, which a contract schema could never take."""

    target: str
    framework: str
    owned_schemas: tuple[str, ...] = ()


def native_docs_file(
    native_docs: NativeDocsDocument | None,
    kept_operations: Mapping[str, object],
    framework_document: FrameworkDocument,
    refusals: Refusals,
) -> GeneratedFile | None:
    """None, with a refusal, when the runner handed no document or the document lacks a kept operation."""
    if native_docs is None:
        refusals.add(
            "artefacts.nativeDocs.document-missing",
            f"The runner handed the {framework_document.target} target no seampact OpenAPI document, which "
            "'nativeDocs: true' needs.",
            f"Update seampact-ir to the release of seampact-{framework_document.target}, whose runner hands the "
            "document.",
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

    operations = {operation_id: found[operation_id] for operation_id in kept_operations}
    components = native_docs.document.get(_COMPONENTS)
    reached = reached_components(list(operations.values()), components if isinstance(components, dict) else {})

    if _refuse_framework_clashes(reached, framework_document, refusals):
        return None

    content = {"operations": operations, _COMPONENTS: reached}

    return GeneratedFile(NATIVE_DOCS_FILE, json.dumps(content, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def _refuse_framework_clashes(
    reached: Mapping[str, object], framework_document: FrameworkDocument, refusals: Refusals
) -> bool:
    """The framework's document owns these schemas, so a contract schema of the same name could never join it."""
    schemas = reached.get("schemas")
    framework = framework_document.framework
    clashing = [name for name in framework_document.owned_schemas if isinstance(schemas, dict) and name in schemas]

    for name in clashing:
        refusals.add(
            "artefacts.nativeDocs.component-clash",
            f"The contract schema '{name}' has the name of a component {framework}'s own document holds, so "
            "'nativeDocs' cannot add it.",
            f"Switch 'nativeDocs' off for this api, or rename the schema in the contract ({framework} owns the name "
            f"'{name}', so its model cannot be renamed).",
            _AT,
        )

    return bool(clashing)


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


def reached_components(operations: Sequence[object], components: Mapping[str, object]) -> dict[str, object]:
    """The components the operations reach: each `$ref` into `#/components/`, followed through the components it
    names, and each security scheme an operation's `security` names."""
    reached: dict[tuple[str, str], object] = {}
    pending: list[object] = list(operations)

    for native in operations:
        operation = native.get("operation") if isinstance(native, dict) else None
        requirements = operation.get(_SECURITY) if isinstance(operation, dict) else None

        for requirement in requirements if isinstance(requirements, list) else []:
            for scheme in requirement if isinstance(requirement, dict) else {}:
                _reach(components, _SECURITY_SCHEMES, scheme, reached, pending)

    while pending:
        value = pending.pop()

        if isinstance(value, list):
            pending.extend(value)
        elif isinstance(value, dict):
            reference = value.get(_REF)

            if isinstance(reference, str) and reference.startswith(_COMPONENT_REF_PREFIX):
                kind, _, name = reference.removeprefix(_COMPONENT_REF_PREFIX).partition("/")
                _reach(components, kind, name, reached, pending)

            pending.extend(value.values())

    kept: dict[str, dict[str, object]] = {}

    for (kind, name), component in sorted(reached.items()):
        kept.setdefault(kind, {})[name] = component

    return dict(kept)


def _reach(
    components: Mapping[str, object],
    kind: str,
    name: str,
    reached: dict[tuple[str, str], object],
    pending: list[object],
) -> None:
    named = components.get(kind)

    if (kind, name) in reached or not isinstance(named, dict) or name not in named:
        return

    reached[(kind, name)] = named[name]
    pending.append(named[name])

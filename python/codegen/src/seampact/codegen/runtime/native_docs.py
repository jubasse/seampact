"""seampact's operation objects and components a `nativeDocs` placement carries (ADR 0026 "Native docs"), read from the
generated `native_docs.json`, and how they join the framework's own OpenAPI document (FastAPI's, Django Ninja's): each
contract operation at seampact's path under the entry's `mount`, and seampact's components beside the app's; a
component the app's document already holds with another value is refused, naming it."""

import copy
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

_OPERATIONS: Final = "operations"
_COMPONENTS: Final = "components"
_PATH: Final = "path"
_METHOD: Final = "method"
_OPERATION: Final = "operation"

type JsonObject = dict[str, object]


@dataclass(frozen=True, slots=True)
class DocumentJoin:
    """Whose document the api's operations join, as a refusal names them: the framework's and the api's names."""

    framework: str
    api: str


@dataclass(frozen=True, slots=True)
class NativeOperation:
    """seampact's operation object of one contract operation, with the path and lower-case method it sits under in
    seampact's document."""

    path: str
    method: str
    operation: JsonObject


@dataclass(frozen=True, slots=True)
class NativeDocs:
    """What `nativeDocs` adds to FastAPI's document: each kept operation's object by operation id, and seampact's
    components by kind and name."""

    operations: Mapping[str, NativeOperation]
    components: Mapping[str, JsonObject]


class NativeDocsError(Exception):
    """The framework's document and seampact's name one component with two values, or the generated file does not
    read."""


def read_native_docs(file: Path) -> NativeDocs:
    """The generated `native_docs.json` beside the placement module."""
    document = json_object(json.loads(file.read_text(encoding="utf-8")), file.name)
    operations: dict[str, NativeOperation] = {}

    for operation_id, item in json_object(document.get(_OPERATIONS), _OPERATIONS).items():
        native = json_object(item, operation_id)
        operations[operation_id] = NativeOperation(
            _text_member(native, _PATH, operation_id),
            _text_member(native, _METHOD, operation_id),
            json_object(native.get(_OPERATION), operation_id),
        )

    components = {
        kind: json_object(named, kind) for kind, named in json_object(document.get(_COMPONENTS), _COMPONENTS).items()
    }

    return NativeDocs(operations, components)


def _text_member(native: JsonObject, key: str, operation_id: str) -> str:
    value = native.get(key)

    if not isinstance(value, str):
        raise NativeDocsError(
            f"seampact: the operation '{operation_id}' of native_docs.json has no '{key}'; run `seampact generate`."
        )

    return value


def json_object(value: object, where: str) -> JsonObject:
    if not isinstance(value, dict):
        raise NativeDocsError(f"seampact: '{where}' of the OpenAPI document is not an object; run `seampact generate`.")

    return value


def require_every_operation(operation_ids: Iterable[str], native_docs: NativeDocs) -> None:
    """An operation `native_docs.json` lacks means the file is stale or edited: fail at boot, not in the document."""
    for operation_id in operation_ids:
        if operation_id not in native_docs.operations:
            raise NativeDocsError(
                f"seampact: native_docs.json holds no operation '{operation_id}', which the api serves; "
                "run `seampact generate`."
            )


def add_native_docs(
    document: JsonObject, operation_ids: Iterable[str], mount: str, native_docs: NativeDocs, joined: DocumentJoin
) -> None:
    """Each operation at seampact's path under `mount`, with the contract's parameter names, then the components."""
    paths = _member(document, "paths")

    for operation_id in operation_ids:
        native = native_docs.operations[operation_id]
        _member(paths, mount.rstrip("/") + native.path)[native.method] = copy.deepcopy(native.operation)

    components = _member(document, _COMPONENTS)

    for kind, named in native_docs.components.items():
        held = _member(components, kind)

        for name, value in named.items():
            if name in held and held[name] != value:
                raise NativeDocsError(
                    f"seampact: {joined.framework}'s document already holds the component {kind} '{name}', and api "
                    f"'{joined.api}' declares another one under that name. Rename the app's model, or switch "
                    "`nativeDocs` off."
                )

            held[name] = copy.deepcopy(value)


def _member(document: JsonObject, key: str) -> JsonObject:
    """The object `document` holds at `key`, added empty when absent."""
    return json_object(document.setdefault(key, {}), key)

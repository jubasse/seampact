"""The declarations of FastAPI's own OpenAPI document an api's placement carries (ADR 0026 "Native docs"): the
entry's `frameworkDocs`, and with `nativeDocs` seampact's operation objects and components, read from the generated
`native_docs.json`."""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final

_OPERATIONS: Final = "operations"
_COMPONENTS: Final = "components"
_PATH: Final = "path"
_METHOD: Final = "method"
_OPERATION: Final = "operation"

type JsonObject = dict[str, object]


class FrameworkDocs(StrEnum):
    """The entry's `frameworkDocs`: `keep` leaves FastAPI's documentation routes as the app has them, `off` removes
    them."""

    KEEP = "keep"
    OFF = "off"


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
    """FastAPI's document and seampact's name one component with two values, or the generated file does not read."""


def read_native_docs(file: Path) -> NativeDocs:
    """The generated `native_docs.json` beside the placement module."""
    document = json_object(json.loads(file.read_text(encoding="utf-8")), file.name)
    operations: dict[str, NativeOperation] = {}

    for operation_id, item in json_object(document.get(_OPERATIONS), _OPERATIONS).items():
        native = json_object(item, operation_id)
        operations[operation_id] = NativeOperation(
            str(native.get(_PATH)), str(native.get(_METHOD)), json_object(native.get(_OPERATION), operation_id)
        )

    components = {
        kind: json_object(named, kind) for kind, named in json_object(document.get(_COMPONENTS), _COMPONENTS).items()
    }

    return NativeDocs(operations, components)


def json_object(value: object, where: str) -> JsonObject:
    if not isinstance(value, dict):
        raise NativeDocsError(f"seampact: '{where}' of the OpenAPI document is not an object; run `seampact generate`.")

    return value

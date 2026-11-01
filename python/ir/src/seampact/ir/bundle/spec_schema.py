"""A JSON Schema of `@seampact/spec`, copied into `seampact/ir/schemas/` and checked through the pinned `jsonschema`
2020-12 validator, so no schema is ported by hand. A test keeps the copies equal to the spec."""

import json
from collections.abc import Mapping
from functools import cache
from importlib import resources
from itertools import islice
from typing import Any, Final

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from seampact.ir.bundle.discriminator_rewrite import JsonObject, rewrite_discriminators
from seampact.ir.bundle.text import quoted

_IR_SCHEMA_ID: Final = "https://seampact.dev/schemas/ir/ir.schema.json"
_MANIFEST_SCHEMA_ID: Final = "https://seampact.dev/schemas/bundle/manifest.schema.json"
_PROBLEMS_MAX: Final = 100

# The document type `jsonschema` declares for its registry; the schemas are plain JSON objects.
type _SchemaDocument = bool | Mapping[str, Any]


class SpecSchema:
    def __init__(self, validator: Draft202012Validator) -> None:
        self._validator = validator

    def problems(self, document: object) -> list[str]:
        """The problems of `document`, each `at '<pointer>' '<problem>'`; empty when it is valid."""
        errors = islice(self._validator.iter_errors(document), _PROBLEMS_MAX)

        return [f"at {quoted(_pointer_of(error.absolute_path))} {quoted(error.message)}" for error in errors]


def _pointer_of(path: object) -> str:
    return "".join(f"/{str(step).replace('~', '~0').replace('/', '~1')}" for step in path)  # type: ignore[attr-defined]


def schema_document(relative_path: str) -> JsonObject:
    """A shipped schema copy, by its path below `seampact/ir/schemas/` (`bundle/manifest.schema.json`)."""
    text = (resources.files("seampact.ir") / "schemas" / relative_path).read_text(encoding="utf-8")
    document = json.loads(text)

    if not isinstance(document, dict):
        raise ValueError(f"seampact-ir: the schema '{relative_path}' is not a JSON object; reinstall seampact-ir.")

    return document


@cache
def ir_schema() -> SpecSchema:
    """The open IR JSON Schema, its `discriminator` unions rewritten (see `rewrite_discriminators`)."""
    directory = resources.files("seampact.ir") / "schemas" / "ir"
    names = sorted(entry.name for entry in directory.iterdir() if entry.name.endswith(".schema.json"))
    resources_by_id: list[tuple[str, Resource[_SchemaDocument]]] = []

    for name in names:
        schema = rewrite_discriminators(name, schema_document(f"ir/{name}"))
        resources_by_id.append((str(schema["$id"]), Resource.from_contents(schema, default_specification=DRAFT202012)))

    registry: Registry[_SchemaDocument] = Registry().with_resources(resources_by_id)

    return SpecSchema(Draft202012Validator({"$ref": _IR_SCHEMA_ID}, registry=registry))


@cache
def manifest_schema() -> SpecSchema:
    return SpecSchema(Draft202012Validator(manifest_schema_document()))


@cache
def manifest_schema_document() -> JsonObject:
    """The manifest schema itself, the one source of the portable-path rule (`$defs/path`)."""
    return schema_document("bundle/manifest.schema.json")

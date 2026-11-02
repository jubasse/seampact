"""The parameter parts of each operation's input (ADR 0026 "Types and validation"), as object schemas the shared
Pydantic emitter writes beside the api's own: `<Op>Path`, `<Op>Query` and `<Op>Headers` hold the parameters the
handler reads. The input dependency validates each part of the boundary's decoded tree with its model in strict mode,
and the runtime renames members through the same member table as every schema. Their ids (`<operationId>.path`)
cannot be the id of a declared schema; a class name taken twice is refused as `name.collision`."""

import dataclasses
from collections.abc import Sequence

from seampact.codegen.kept_forms import handler_headers
from seampact.fastapi.layout import ApiLayout
from seampact.ir.model import (
    ContractIR,
    Direction,
    Docs,
    Name,
    NameRole,
    ObjectSchema,
    Operation,
    Origin,
    Param,
    Property,
    Schema,
    TypeUse,
)

INPUT_PARTS = (("path", NameRole.PATH), ("query", NameRole.QUERY), ("headers", NameRole.HEADERS))


def input_schema_id(operation_id: str, part: str) -> str:
    return f"{operation_id}.{part}"


def with_input_schemas(ir: ContractIR, layout: ApiLayout) -> ContractIR:
    """A copy of `ir` whose schemas also hold each operation's parameter parts."""
    schemas: dict[str, Schema] = dict(ir.schemas)

    for index, operation in enumerate(ir.operations):
        if operation.id not in layout.operations:
            continue

        origin = Origin(layer="api", pointer=f"/operations/{index}")

        for part, role in INPUT_PARTS:
            params = _part_params(operation, part)

            if params:
                part_id = input_schema_id(operation.id, part)
                members = [_param_member(param, origin) for param in params]
                schemas[part_id] = _object(part_id, operation, role, members, origin)

    return dataclasses.replace(ir, schemas=schemas)


def _part_params(operation: Operation, part: str) -> Sequence[Param]:
    if part == "path":
        return operation.params.path

    return operation.params.query if part == "query" else handler_headers(operation)


def _object(
    schema_id: str, operation: Operation, role: NameRole, members: list[Property], origin: Origin
) -> ObjectSchema:
    return ObjectSchema(
        properties=tuple(members),
        id=schema_id,
        name=Name(segments=tuple(operation.name.segments), role=role),
        directions=(Direction.INPUT,),
        examples=(),
        docs=Docs(),
        extensions={},
        origin=origin,
    )


def _param_member(param: Param, origin: Origin) -> Property:
    # A parameter's default goes to the emitter, which refuses a member default by name.
    return dataclasses.replace(
        _member(param.name, param.type, origin, optional=not param.required), default=param.default
    )


def _member(name: str, type_use: TypeUse, origin: Origin, *, optional: bool) -> Property:
    return Property(
        name=name,
        type=type_use,
        optional=optional,
        nullable=False,
        sensitive=False,
        deprecated=False,
        docs=Docs(),
        extensions={},
        origin=origin,
    )

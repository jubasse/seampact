"""The Python names of one api (ADR 0007 sections 4 and 5, ADR 0026 "Naming"): a class per object schema and per
enum, an attribute per object member and an upper snake case member per enum value. Two members of one object that
give the same identifier (`2fa` and `field_2fa`) are refused, naming both, and so are two parameters of one part and
two classes of one module."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.model import ContractIR, Name, NameRole, ObjectSchema, Param
from seampact.ir.naming import IrName, NameSource, NamingRole, python_identifier, segments_of


@dataclass(frozen=True, slots=True)
class ApiNames:
    """`schema_classes` (object schemas) and `enum_classes` by id; `members` maps each object schema's wire names to
    attributes; `enum_members` each enum value to its member."""

    schema_classes: Mapping[str, str]
    enum_classes: Mapping[str, str]
    members: Mapping[str, Mapping[str, str]]
    enum_members: Mapping[str, Mapping[str, str]]


def api_names(ir: ContractIR, refusals: Refusals) -> ApiNames:
    schema_classes = {
        schema_id: _type_identifier(schema.name, IrPlace(f"/schemas/{schema_id}/name"), refusals)
        for schema_id, schema in sorted(ir.schemas.items())
        if isinstance(schema, ObjectSchema)
    }
    enum_classes = {
        enum_id: _type_identifier(ir.enums[enum_id].name, IrPlace(f"/enums/{enum_id}/name"), refusals)
        for enum_id in sorted(ir.enums)
    }
    members: dict[str, dict[str, str]] = {}
    enum_members: dict[str, dict[str, str]] = {}

    _refuse_collisions(
        [(name, IrPlace(f"/schemas/{schema_id}/name")) for schema_id, name in schema_classes.items()]
        + [(name, IrPlace(f"/enums/{enum_id}/name")) for enum_id, name in enum_classes.items()],
        "class",
        refusals,
    )

    for schema_id, schema in sorted(ir.schemas.items()):
        if isinstance(schema, ObjectSchema):
            members[schema_id] = _object_members(schema_id, schema, refusals)

    for enum_id, enum in sorted(ir.enums.items()):
        at = IrPlace(f"/enums/{enum_id}")
        enum_members[enum_id] = {
            value: _enum_member(value, position, enum.code_names, at.below("values", position - 1), refusals)
            for position, value in enumerate(enum.values, start=1)
        }
        _refuse_collisions(
            [(member, at.below("values", index)) for index, member in enumerate(enum_members[enum_id].values())],
            "enum member",
            refusals,
        )

    return ApiNames(schema_classes, enum_classes, members, enum_members)


def member_identifier(written: str, code_name: Name | None = None) -> str | None:
    """The attribute of a member or parameter written `written`; None when the name has no segment."""
    segments = list(code_name.segments) if code_name is not None else segments_of(written, NameSource.NAME, None, None)

    return None if segments is None else python_identifier(IrName(tuple(segments), NamingRole.MEMBER))


def part_attributes(params: Sequence[Param], at: IrPlace, refusals: Refusals) -> list[tuple[int, Param, str]]:
    """The position, parameter and attribute of each parameter of one part (path, query or headers) placed at `at`; a
    parameter with no name segment is refused, and so are two that give one attribute."""
    attributes: list[tuple[int, Param, str]] = []

    for index, param in enumerate(params):
        attribute = member_identifier(param.name)

        if attribute is None:
            refusals.inconsistent("name.segment.missing", f"The parameter '{param.name}' has no name segment", at)
            continue

        attributes.append((index, param, attribute))

    _refuse_collisions([(attribute, at.below(index)) for index, _, attribute in attributes], "parameter", refusals)

    return attributes


def _object_members(schema_id: str, schema: ObjectSchema, refusals: Refusals) -> dict[str, str]:
    at = IrPlace(f"/schemas/{schema_id}/properties")
    attributes: dict[str, str] = {}
    placed: list[tuple[str, IrPlace]] = []

    for index, member in enumerate(schema.properties):
        attribute = member_identifier(member.name, member.code_name)

        if attribute is None:
            refusals.inconsistent("name.segment.missing", f"The member '{member.name}' has no name segment", at)
            continue

        attributes[member.name] = attribute
        placed.append((attribute, at.below(index)))

    _refuse_collisions(placed, "member", refusals)

    return attributes


def _enum_member(
    value: str, position: int, code_names: Mapping[str, Name] | None, at: IrPlace, refusals: Refusals
) -> str:
    code_name = None if code_names is None else code_names.get(value)
    segments = (
        list(code_name.segments) if code_name is not None else segments_of(value, NameSource.ENUM_VALUE, None, position)
    )

    if segments is None:
        refusals.inconsistent("name.segment.missing", f"The enum value '{value}' has no name segment", at)
        return value

    return python_identifier(IrName(tuple(segments), NamingRole.ENUM_MEMBER))


def _type_identifier(name: Name, at: IrPlace, refusals: Refusals) -> str:
    if not isinstance(name.role, NameRole):
        refusals.unknown_value(name.role.raw, at.below("role"))
        return "_"

    return python_identifier(IrName(tuple(name.segments), NamingRole(name.role.value), name.status))


def _refuse_collisions(placed: list[tuple[str, IrPlace]], kind: str, refusals: Refusals) -> None:
    first_place: dict[str, IrPlace] = {}

    for identifier, at in placed:
        earlier = first_place.setdefault(identifier, at)

        if earlier is not at:
            refusals.add(
                "name.collision",
                f"The {kind} at {earlier.pointer} and the {kind} at {at.pointer} both give the Python name "
                f"'{identifier}'.",
                "Rename one of them in the contract, or give one a `codeName`.",
                at,
            )

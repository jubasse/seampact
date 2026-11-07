"""The walk of the raw document for an unknown tag or value of a must-act union or open enum (ADR 0005 section 3)."""

import re
from collections.abc import Mapping
from typing import Final, assert_never

from seampact.ir.model.shapes import SHAPES
from seampact.ir.read.refusal import (
    IrRefusal,
    IrRefusalCode,
    PointerStep,
    RefusalList,
    in_message,
    pointer_of,
)
from seampact.ir.shape import (
    ItemsShape,
    NamedShape,
    OpenEnumShape,
    Shape,
    StructShape,
    UnionShape,
    ValuesShape,
)

_ROOT: Final = NamedShape("ContractIR")
_OPERATION_POINTER: Final = re.compile(r"^/operations/(\d+)(?:/|$)")


def check_must_act(ir: object) -> list[IrRefusal]:
    """One refusal per unknown tag or value of a must-act union or open enum, found by walking the raw document with
    the generated shapes: the same walk as `listIrUnknowns`, so an unknown that is not must-act is left to the model,
    which keeps it as `Unknown`. Array items and map values are walked; unknown members and opaque values are data,
    never walked, and a union with an unknown tag is not descended into. Never raises on a malformed document: a
    shape the schema refuses is skipped, and the hydration that follows reports it. Stops after 100 refusals. The
    walk recurses per level: the reader bounds the nesting of the whole document first."""
    walk = _MustActWalk(ir)
    walk.walk(ir, _ROOT, None)

    return walk.refusals.all()


class _MustActWalk:
    def __init__(self, document: object) -> None:
        self._document = document
        self.refusals = RefusalList()

    def walk(self, value: object, shape: Shape, pointer: PointerStep | None) -> None:
        if self.refusals.is_full():
            return

        match shape:
            case NamedShape(definition):
                named = SHAPES.get(definition)
                if named is not None:
                    self.walk(value, named, pointer)
            case StructShape(members):
                self._walk_struct(value, members, pointer)
            case UnionShape():
                self._walk_union(value, shape, pointer)
            case OpenEnumShape(known, must_act):
                if isinstance(value, str) and must_act and value not in known:
                    self._refuse(pointer, value, known, "value")
            case ItemsShape(of):
                if isinstance(value, list):
                    for index, item in enumerate(value):
                        self.walk(item, of, PointerStep(pointer, str(index)))
            case ValuesShape(of):
                if isinstance(value, dict):
                    for key, item in value.items():
                        self.walk(item, of, PointerStep(pointer, key))
            case _:
                assert_never(shape)

    def _walk_struct(self, value: object, members: Mapping[str, Shape], pointer: PointerStep | None) -> None:
        if not isinstance(value, dict):
            return

        for name, child in value.items():
            member_shape = members.get(name)
            if member_shape is not None:
                self.walk(child, member_shape, PointerStep(pointer, name))

    def _walk_union(self, value: object, shape: UnionShape, pointer: PointerStep | None) -> None:
        if not isinstance(value, dict):
            return

        tag = value.get(shape.tag)

        if not isinstance(tag, str):
            return

        variant = shape.variants.get(tag)

        if variant is not None:
            self.walk(value, NamedShape(variant), pointer)
            return

        if shape.must_act:
            self._refuse(PointerStep(pointer, shape.tag), tag, tuple(shape.variants), "tag")

    def _refuse(self, pointer: PointerStep | None, value: str, expected: tuple[str, ...], what: str) -> None:
        member = pointer_of(pointer)
        operation = self._operation_at(member)
        where = "" if operation is None else f" in operation '{in_message(operation)}'"
        self.refusals.add(
            IrRefusal(
                IrRefusalCode.MUST_ACT_UNKNOWN,
                member,
                value,
                expected,
                operation,
                f"The {what} '{in_message(value)}' at {in_message(member)}{where} is unknown to this reader and guards "
                "a security boundary: a reader that skipped it would apply a weaker check, so it refuses the IR.",
            )
        )

    def _operation_at(self, pointer: str) -> str | None:
        matched = _OPERATION_POINTER.match(pointer)

        if matched is None:
            return None

        index = int(matched.group(1))
        operations = self._document.get("operations") if isinstance(self._document, dict) else None
        operation = operations[index] if isinstance(operations, list) and index < len(operations) else None
        operation_id = operation.get("id") if isinstance(operation, dict) else None

        return operation_id if isinstance(operation_id, str) else f"#{index}"

"""The nesting bound counts every container the hydrator walks, not only `dict` and `list`."""

from collections.abc import Mapping
from types import MappingProxyType

from seampact.ir.read.nesting import MAX_NESTING_DEPTH, check_document_nesting
from seampact.ir.read.refusal import IrRefusalCode


def _nested_tuples(depth: int) -> object:
    value: object = ()

    for _ in range(depth):
        value = (value,)

    return value


def test_a_document_of_nested_tuples_past_the_bound_is_refused() -> None:
    refusal = check_document_nesting({"example": _nested_tuples(MAX_NESTING_DEPTH * 2)})

    assert refusal is not None
    assert refusal.code == IrRefusalCode.NESTING_TOO_DEEP


def test_a_document_of_nested_mappings_past_the_bound_is_refused() -> None:
    value: Mapping[str, object] = MappingProxyType({})

    for _ in range(MAX_NESTING_DEPTH * 2):
        value = MappingProxyType({"child": value})

    refusal = check_document_nesting(value)

    assert refusal is not None
    assert refusal.code == IrRefusalCode.NESTING_TOO_DEEP

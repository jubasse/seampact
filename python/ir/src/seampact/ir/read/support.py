"""What a reader declares it reads, and the check of `irVersion`, `irRevision`, kinds and features.

The port of `checkIrSupport` of `@seampact/spec/ir` (ADR 0005 sections 2 and 3).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from seampact.ir.model.version import IR_REVISION, IR_VERSION
from seampact.ir.read.refusal import (
    IrRefusal,
    IrRefusalCode,
    Missing,
    RefusalList,
    in_message,
    refused_json_type,
    shown,
)

# The package a refused version or revision tells the reader to update.
PACKAGE: Final = "seampact-ir"


@dataclass(frozen=True, slots=True)
class IrSupport:
    """The `irVersion` values, the exact `irRevision`, and the declaration kinds and must-understand features."""

    ir_versions: tuple[int, ...]
    ir_revision: int
    kinds: tuple[str, ...]
    features: tuple[str, ...]

    @staticmethod
    def of_model(kinds: Sequence[str], features: Sequence[str] = ()) -> "IrSupport":
        """The support of this model: its own version and revision, the given kinds and features."""
        return IrSupport((IR_VERSION,), IR_REVISION, tuple(kinds), tuple(features))


def check_support(ir: object, support: IrSupport) -> list[IrRefusal]:
    """One named refusal per unsupported `irVersion`, different `irRevision`, unknown kind or unknown feature, top
    level and per operation. An unsupported `irVersion` is returned alone: the rest of the document may have another
    shape. A list that is missing or not an array is named (`ir.support.malformed`), never read as empty. Stops after
    100 refusals. Reads the document as untrusted data and never raises."""
    document: Mapping[str, object] = ir if isinstance(ir, dict) else {}
    version = document.get("irVersion", Missing.ABSENT)

    if not any(_is_number_equal(version, supported) for supported in support.ir_versions):
        return [_version_refusal(version, support)]

    refusals = RefusalList()
    revision = document.get("irRevision", Missing.ABSENT)

    if not _is_number_equal(revision, support.ir_revision):
        refusals.add(_revision_refusal(revision, support))

    kinds = _list_of(document.get("kinds", Missing.ABSENT), "/kinds", None, refusals)
    _unknown_in(kinds, support.kinds, IrRefusalCode.KIND_UNSUPPORTED, "/kinds", None, refusals)
    features = _list_of(document.get("features", Missing.ABSENT), "/features", None, refusals)
    _unknown_in(features, support.features, IrRefusalCode.FEATURE_UNSUPPORTED, "/features", None, refusals)
    operations = _list_of(document.get("operations", Missing.ABSENT), "/operations", None, refusals)

    for index, entry in enumerate(operations):
        if refusals.is_full():
            break
        _check_operation(entry, index, support, refusals)

    return refusals.all()


def _check_operation(entry: object, index: int, support: IrSupport, refusals: RefusalList) -> None:
    operation: Mapping[str, object] = entry if isinstance(entry, dict) else {}
    id_value = operation.get("id", Missing.ABSENT)
    operation_id = id_value if isinstance(id_value, str) else f"#{index}"
    kind = operation.get("kind", Missing.ABSENT)

    if not _is_string_in(kind, support.kinds):
        refusals.add(
            IrRefusal(
                IrRefusalCode.KIND_UNSUPPORTED,
                f"/operations/{index}/kind",
                shown(kind),
                support.kinds,
                operation_id,
                f"The declaration kind '{in_message(shown(kind))}' of operation '{in_message(operation_id)}' "
                "is not supported by this reader.",
            )
        )

    member = f"/operations/{index}/features"
    features = _list_of(operation.get("features", Missing.ABSENT), member, operation_id, refusals)
    _unknown_in(features, support.features, IrRefusalCode.FEATURE_UNSUPPORTED, member, operation_id, refusals)


def _list_of(value: object, member: str, operation: str | None, refusals: RefusalList) -> list[object]:
    """The items of a list, or none and a refusal naming what was found instead."""
    if isinstance(value, list):
        return list(value)

    found = refused_json_type(value)
    refusals.add(
        IrRefusal(
            IrRefusalCode.SUPPORT_MALFORMED,
            member,
            found,
            ("array",),
            operation,
            f"{member} is {found}, not an array: this reader cannot check what it supports.",
        )
    )

    return []


def _unknown_in(
    values: list[object],
    known: tuple[str, ...],
    code: IrRefusalCode,
    member: str,
    operation: str | None,
    refusals: RefusalList,
) -> None:
    what = "declaration kind" if code is IrRefusalCode.KIND_UNSUPPORTED else "feature"
    where = "" if operation is None else f" in operation '{in_message(operation)}'"

    for index, value in enumerate(values):
        if refusals.is_full():
            return

        if _is_string_in(value, known):
            continue

        refusals.add(
            IrRefusal(
                code,
                f"{member}/{index}",
                shown(value),
                known,
                operation,
                f"The {what} '{in_message(shown(value))}'{where} is not supported by this reader.",
            )
        )


def _is_string_in(value: object, known: tuple[str, ...]) -> bool:
    return isinstance(value, str) and value in known


def _is_number_equal(value: object, expected: int) -> bool:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return False

    return value == expected


def _version_refusal(version: object, support: IrSupport) -> IrRefusal:
    expected = tuple(str(supported) for supported in support.ir_versions)

    return IrRefusal(
        IrRefusalCode.VERSION_UNSUPPORTED,
        "/irVersion",
        shown(version),
        expected,
        None,
        f"irVersion {in_message(shown(version))} is not one this reader reads ({', '.join(expected)}). "
        f"Update the {PACKAGE} package to one that reads it.",
    )


def _revision_refusal(revision: object, support: IrSupport) -> IrRefusal:
    return IrRefusal(
        IrRefusalCode.REVISION_MISMATCH,
        "/irRevision",
        shown(revision),
        (str(support.ir_revision),),
        None,
        f"irRevision {in_message(shown(revision))} differs from the revision this reader was built for "
        f"({support.ir_revision}). Update the {PACKAGE} package to the revision of the compiler.",
    )

"""The refusal of an entry whose target has no row in the compatibility matrix: without it the boot check would not
know the framework versions `generate` accepted, so every Python target fails closed rather than serve unchecked."""

from typing import Final

from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.run.generator import TargetEntry

MATRIX_ROW_MISSING: Final = "config.matrix.row-missing"


def refuse_missing_matrix_row(entry: TargetEntry, refusals: Refusals, frameworks: str) -> None:
    """`frameworks` names what the row pins, as messages read it (`FastAPI and Starlette`)."""
    if entry.matrix is not None:
        return

    refusals.add(
        MATRIX_ROW_MISSING,
        f"The compatibility matrix has no row for {entry.use}, so the boot check would not know the {frameworks} "
        "versions generate accepted.",
        f"Reinstall seampact-ir: its copy of the compatibility matrix lacks the {entry.use} row.",
        IrPlace(""),
    )

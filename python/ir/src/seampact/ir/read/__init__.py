"""The IR reader: the nesting, support and must-act checks of ADR 0005, then the generated model's hydrator."""

from seampact.ir.read.reader import read_document, read_ir
from seampact.ir.read.refusal import IrMalformedError, IrRefusal, IrRefusalCode, IrRefusedError
from seampact.ir.read.support import IrSupport

__all__ = [
    "IrMalformedError",
    "IrRefusal",
    "IrRefusalCode",
    "IrRefusedError",
    "IrSupport",
    "read_document",
    "read_ir",
]

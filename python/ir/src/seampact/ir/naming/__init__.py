"""The native naming of ADR 0007: name segments, roles and operation ids, checked against the shared vectors.

The Python identifier of a name waits for a Python column in ADR 0007's reserved-word lists and vectors.
"""

from seampact.ir.naming.name import IrName, NameSource, NamingRole, OperationIdCase, operation_id
from seampact.ir.naming.split import segments_of, split_name

__all__ = [
    "IrName",
    "NameSource",
    "NamingRole",
    "OperationIdCase",
    "operation_id",
    "segments_of",
    "split_name",
]

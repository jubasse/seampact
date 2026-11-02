"""The native naming of ADR 0007: name segments, roles, operation ids and Python identifiers, checked against the
shared vectors."""

from seampact.ir.naming.name import IrName, NameSource, NamingRole, OperationIdCase, operation_id
from seampact.ir.naming.python_identifier import python_identifier
from seampact.ir.naming.split import segments_of, split_name

__all__ = [
    "IrName",
    "NameSource",
    "NamingRole",
    "OperationIdCase",
    "operation_id",
    "python_identifier",
    "segments_of",
    "split_name",
]

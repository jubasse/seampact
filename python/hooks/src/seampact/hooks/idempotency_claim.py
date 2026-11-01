"""The claim an idempotent request makes on its key: the key, the request's fingerprint and the key's lifetime."""

from dataclasses import dataclass

from seampact.hooks.operation_ref import OperationRef


@dataclass(frozen=True, slots=True, kw_only=True)
class IdempotencyClaim:
    key: str
    fingerprint: str
    lifetime_ms: int
    operation: OperationRef

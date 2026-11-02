"""The run-time settings and generated types every Pydantic target's `bind_<api>()` hands its runtime: the settings
the app gives in code, per api and per operation, and the generated types of each operation."""

from collections.abc import Mapping
from dataclasses import dataclass

from seampact.codegen.runtime.reply_verdict import ResponsesMode


@dataclass(frozen=True, slots=True, kw_only=True)
class OperationSettings:
    """The run-time settings of one operation, which win over the api's."""

    responses: ResponsesMode | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class RunSettings:
    """The run-time settings `bind_<api>()` takes from the app's own settings; None keeps the target option."""

    responses: ResponsesMode | None
    body_validation: bool | None
    operations: Mapping[str, OperationSettings]
    public_origin: str | None


@dataclass(frozen=True, slots=True, kw_only=True)
class OperationTypes:
    """The generated types of one operation the runtime builds and reads: its request, its success classes by status,
    its errors class, and the model of its body's rule proofs when it has some."""

    request: type
    responses: tuple[tuple[int, type], ...]
    errors: type
    proofs: type | None = None

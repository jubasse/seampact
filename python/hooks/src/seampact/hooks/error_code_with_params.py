"""A declared error code and its parameters, the answer of a hook that denies."""

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True, kw_only=True)
class ErrorCodeWithParams:
    code: str
    params: Mapping[str, object] | None = None

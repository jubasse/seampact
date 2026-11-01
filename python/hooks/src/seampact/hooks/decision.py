"""The decide hook's answer: allowed, or a denial with its declared error."""

from dataclasses import dataclass

from seampact.hooks.error_code_with_params import ErrorCodeWithParams


@dataclass(frozen=True, slots=True, kw_only=True)
class Allowed:
    pass


@dataclass(frozen=True, slots=True, kw_only=True)
class Denied:
    deny: ErrorCodeWithParams


type Decision = Allowed | Denied

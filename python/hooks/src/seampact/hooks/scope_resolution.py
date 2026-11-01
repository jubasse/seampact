"""The resolve-scope hook's answer: the resolved scope, or a denial with its declared error."""

from dataclasses import dataclass

from seampact.hooks.error_code_with_params import ErrorCodeWithParams
from seampact.hooks.resolved_scope import ResolvedScope


@dataclass(frozen=True, slots=True, kw_only=True)
class Resolved:
    resolved: ResolvedScope


@dataclass(frozen=True, slots=True, kw_only=True)
class Denied:
    deny: ErrorCodeWithParams


type ScopeResolution = Resolved | Denied

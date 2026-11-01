"""Where a scope's id comes from: declared in the contract, or resolved by the application from the request."""

from dataclasses import dataclass

from seampact.hooks.request_view import RequestView


@dataclass(frozen=True, slots=True, kw_only=True)
class Declared:
    id: object


@dataclass(frozen=True, slots=True, kw_only=True)
class Custom:
    request: RequestView


type ScopeIdSource = Declared | Custom

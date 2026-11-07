"""What the resolve-scope hook gets: the scope, where its id comes from, the principal and the outer scopes."""

from collections.abc import Mapping
from dataclasses import dataclass

from seampact.hooks.resolved_scope import ResolvedScope
from seampact.hooks.scope_id_source import ScopeIdSource


@dataclass(frozen=True, slots=True, kw_only=True)
class ResolveScopeRequest:
    """`outer_scopes` are the scopes already resolved, outermost first."""

    @dataclass(frozen=True, slots=True, kw_only=True)
    class Extensions:
        """The extension values of the scope and of the operation."""

        scope: Mapping[str, object]
        operation: Mapping[str, object]

    scope: str
    source: ScopeIdSource
    principal: object | None
    outer_scopes: tuple[ResolvedScope, ...]
    extensions: Extensions

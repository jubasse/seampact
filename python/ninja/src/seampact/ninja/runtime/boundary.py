"""The boundary middleware a Ninja api's generated `<Api>Boundary` extends (ADR 0027 "Ninja"): the Django boundary,
whose values and boot check come from `bind_<api>()`. Once the root URLconf is imported, it marks the views of the
api's contract routes as the api's own and `login_required = False`, so Django's `LoginRequiredMiddleware` never
redirects a contract request; Ninja's docs routes are framework routes; and Ninja's own HTTP errors take their role."""

from collections.abc import Iterator, Sequence
from typing import Final

from django.urls import URLPattern, URLResolver, get_resolver

from seampact.django.runtime import ContractBoundary, RecordedRole
from seampact.django.runtime.boot_check import CONTRACT_MARK
from seampact.ninja.runtime.binding import binding_of
from seampact.ninja.runtime.boot_check import binding_hook_problems, binding_problems
from seampact.ninja.runtime.exceptions import ninja_role

LOGIN_REQUIRED_MARK: Final = "login_required"
# The patterns `NinjaAPI.urls` adds beside the operations: its OpenAPI document, its docs page and its root.
_NINJA_FRAMEWORK_NAMES: Final = frozenset({"openapi-json", "openapi-view", "api-root"})


class NinjaContractBoundary(ContractBoundary):
    include_prefix_refused = False

    @classmethod
    def configuration_problems(cls) -> list[str]:
        return binding_problems(cls.api, cls.body_validation)

    @classmethod
    def hook_configuration_problems(cls) -> list[str]:
        return binding_hook_problems(cls.api)

    @classmethod
    def recorded_role(cls, recorded: BaseException) -> RecordedRole | None:
        return ninja_role(recorded)

    @classmethod
    def is_framework_pattern(cls, pattern: URLPattern) -> bool:
        return pattern.name in _NINJA_FRAMEWORK_NAMES

    @classmethod
    def prepare_urlconf(cls) -> None:
        binding = binding_of(cls.api)

        if binding is None:
            return

        route_names = {route.name for route in binding.placement.routes}

        for namespaces, pattern in _named_patterns(get_resolver().url_patterns, ()):
            if pattern.name in route_names and namespaces and namespaces[-1] == binding.api.urls_namespace:
                setattr(pattern.callback, CONTRACT_MARK, cls.contract)
                setattr(pattern.callback, LOGIN_REQUIRED_MARK, False)


def _named_patterns(
    entries: Sequence[URLPattern | URLResolver], namespaces: tuple[str, ...]
) -> Iterator[tuple[tuple[str, ...], URLPattern]]:
    for entry in entries:
        if isinstance(entry, URLResolver):
            inner = (*namespaces, entry.namespace) if entry.namespace else namespaces
            yield from _named_patterns(entry.url_patterns, inner)
        else:
            yield namespaces, entry

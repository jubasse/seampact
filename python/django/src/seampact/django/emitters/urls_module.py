"""The URLconf of one api (ADR 0027 "Routes"): one `path()` entry per contract path, which the app includes at `""`
in its root URLconf. Each placeholder uses Django's `str` converter, so it takes one whole segment, and is named
`path_<attribute>`, so a parameter named `request` or `self` never meets the view's own arguments. Per path depth,
literal segments come before placeholders, as the route table orders them. An entry is named
`seampact.<api>.<operationId>` after the path's first operation, and points to the view the target names."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Final

from seampact.codegen.printer import INDENT, PythonModule, fits, string_literal
from seampact.codegen.routes import RouteEntry

PATH_ARGUMENT_PREFIX: Final = "path_"
"""The prefix of each converter name: the view receives the value of parameter attribute `a` as `path_a`."""


@dataclass(frozen=True, slots=True)
class ContractPath:
    """A contract path and the route entries of the operations it serves, in the api's operation order."""

    entries: tuple[RouteEntry, ...]

    @property
    def first(self) -> RouteEntry:
        return self.entries[0]

    def django_route(self) -> str:
        """The `path()` route: no leading slash, `<str:path_attribute>` for each placeholder."""
        return "/".join(
            segment.text if segment.attribute is None else f"<str:{PATH_ARGUMENT_PREFIX}{segment.attribute}>"
            for segment in self.first.segments
        )


def contract_paths(routes: Sequence[RouteEntry], operation_order: Sequence[str]) -> list[ContractPath]:
    """The api's paths in route order, each with its operations in `operation_order`."""
    position = {operation_id: index for index, operation_id in enumerate(operation_order)}
    grouped: dict[str, list[RouteEntry]] = {}

    for route in routes:
        grouped.setdefault(route.contract_path, []).append(route)

    return [
        ContractPath(tuple(sorted(entries, key=lambda entry: position[entry.operation_id])))
        for entries in grouped.values()
    ]


def routes_named_by_path(paths: Sequence[ContractPath]) -> list[RouteEntry]:
    """Each operation's route under the name the URLconf registers for its path, for `<Api>RouteNames`."""
    return [replace(entry, name=contract_path.first.name) for contract_path in paths for entry in contract_path.entries]


def urls_module(api: str, paths: Sequence[ContractPath], view_of: Callable[[PythonModule, ContractPath], str]) -> str:
    """`view_of` imports the target's views module into the URLconf and returns the view expression of a path."""
    module = PythonModule(f"The URL patterns of api '{api}': include them at \"\" in the root URLconf.")
    urls = module.imported("django.urls", "_urls")
    lines = ["urlpatterns = ["]

    for contract_path in paths:
        arguments = [
            string_literal(contract_path.django_route()),
            view_of(module, contract_path),
            f"name={string_literal(contract_path.first.name)}",
        ]
        single = f"{INDENT}{urls}.path({', '.join(arguments)}),"

        if fits(single):
            lines.append(single)
            continue

        lines += [f"{INDENT}{urls}.path(", *(f"{INDENT * 2}{argument}," for argument in arguments), f"{INDENT}),"]

    lines.append("]")
    module.add_block(lines)

    return module.text()

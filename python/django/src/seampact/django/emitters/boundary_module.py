"""The `django` module of one api: the declaration of its boundary middleware (ADR 0027 "The boundary middleware"),
which the app lists first in `MIDDLEWARE` as `<package>.django.<Api>Boundary`. It records the api, the version of
the generator, the api's contract and settings keys, its handler resources, the framework majors `generate`
accepted, the entry's `frameworkRoutes`, and the target options the boundary reads at run time, each a Python
literal."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from seampact.codegen.placement_lines import tuple_literal
from seampact.codegen.printer import INDENT, PythonModule, bracketed, string_literal
from seampact.ir.run.generator import FrameworkRoute, TargetEntry


@dataclass(frozen=True, slots=True)
class BoundaryBase:
    """The runtime class a generated boundary extends, and the alias of its module."""

    module: str
    alias: str
    name: str


_DJANGO_RUNTIME: Final = "_django_runtime"
SETTINGS_MODULE: Final = ".settings"
DJANGO_BOUNDARY_BASE: Final = BoundaryBase("seampact.django.runtime", _DJANGO_RUNTIME, "ContractBoundary")


def boundary_module(
    api: str,
    api_class: str,
    generated_by: str,
    handler_resources: Mapping[str, Sequence[str]],
    run_time_options: Sequence[tuple[str, str]],
    entry: TargetEntry,
    base: BoundaryBase = DJANGO_BOUNDARY_BASE,
    settings_module: str | None = SETTINGS_MODULE,
) -> str:
    """`base` is the target's own boundary class when the target adds settings keys the boot check reads.
    `settings_module` is None for a target that takes the api's handlers and hooks in code rather than from
    `settings.SEAMPACT`; an empty `handler_resources` is left out likewise."""
    module = PythonModule(f"The Django boundary of api '{api}': list {api_class}Boundary first in MIDDLEWARE.")
    base_module = module.imported(base.module, base.alias)
    frameworks = _accepted_frameworks(_DJANGO_RUNTIME, entry)
    framework_routes = _framework_routes(_DJANGO_RUNTIME, entry.framework_routes)

    if frameworks or framework_routes:
        module.imported(DJANGO_BOUNDARY_BASE.module, _DJANGO_RUNTIME)
    contract = module.imported(".contract", "_contract")
    settings_lines = (
        [f"{INDENT}settings_keys = {module.imported(settings_module, '_settings')}.SETTINGS_KEYS"]
        if settings_module is not None
        else []
    )
    module.add_block(
        [
            f"class {api_class}Boundary({base_module}.{base.name}):",
            f'{INDENT}"""The boundary middleware of api \'{api}\'."""',
            "",
            f"{INDENT}api = {string_literal(api)}",
            f"{INDENT}generated_by = {string_literal(generated_by)}",
            f"{INDENT}contract = {contract}.CONTRACT",
            *settings_lines,
            *(_handler_resources(module, handler_resources) if handler_resources else []),
            *(f"{INDENT}{attribute} = {literal}" for attribute, literal in run_time_options),
            *_tuple_attribute("frameworks", frameworks),
            *_tuple_attribute("framework_routes", framework_routes),
        ]
    )

    return module.text()


def _handler_resources(module: PythonModule, handler_resources: Mapping[str, Sequence[str]]) -> list[str]:
    """Each handler resource's settings key and the operations it serves, so a missing factory names them."""
    typing = module.imported("typing", "_typing")
    abc = module.imported("collections.abc", "_abc")
    lines = [f"{INDENT}handler_resources: {typing}.ClassVar[{abc}.Mapping[str, {abc}.Sequence[str]]] = {{"]

    for resource, operation_ids in handler_resources.items():
        head = f"{string_literal(resource)}: "

        if len(operation_ids) == 1:
            lines.append(f"{INDENT * 2}{head}{tuple_literal(operation_ids)},")
        else:
            lines += bracketed(INDENT * 2, head, [string_literal(item) for item in operation_ids], ",")

    return [*lines, f"{INDENT}}}"]


def _accepted_frameworks(runtime: str, entry: TargetEntry) -> list[str]:
    """The matrix row's frameworks, each by its unit, with the entry's `allowUntested` units and the tested minors."""
    lines: list[str] = []

    for framework in entry.matrix.frameworks if entry.matrix is not None else ():
        arguments = [
            f"package={string_literal(framework.package)}",
            f"unit={runtime}.VersionUnit.{framework.unit.name}",
            f"accepted={tuple_literal(framework.accepted_units(entry.allow_untested))}",
        ]

        if framework.tested_minors:
            arguments.append(f"tested_minors={tuple_literal(framework.tested_minors)}")

        lines += bracketed(INDENT * 2, f"{runtime}.AcceptedFramework", arguments, ",")

    return lines


def _framework_routes(runtime: str, routes: Sequence[FrameworkRoute]) -> list[str]:
    lines: list[str] = []

    for allowed in routes:
        arguments = [
            f"path={string_literal(allowed.path)}",
            f"method={'None' if allowed.method is None else string_literal(allowed.method)}",
            f"reason={string_literal(allowed.reason)}",
        ]
        lines += bracketed(INDENT * 2, f"{runtime}.FrameworkRouteRule", arguments, ",")

    return lines


def _tuple_attribute(name: str, items: list[str]) -> list[str]:
    if not items:
        return [f"{INDENT}{name} = ()"]

    return [f"{INDENT}{name} = (", *items, f"{INDENT})"]

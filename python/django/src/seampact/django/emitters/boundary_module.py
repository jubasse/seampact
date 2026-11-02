"""The `django` module of one api: the declaration of its boundary middleware (ADR 0027 "The boundary middleware"),
which the app lists first in `MIDDLEWARE` as `<package>.django.<Api>Boundary`. It records the api, the version of
the generator, the api's contract and settings keys, its handler resources, the framework majors `generate`
accepted, the entry's `frameworkRoutes`, and the target options the boundary reads at run time, each a Python
literal."""

from collections.abc import Sequence

from seampact.codegen.printer import INDENT, PythonModule, bracketed, string_literal
from seampact.ir.run.generator import FrameworkRoute, TargetEntry


def boundary_module(
    api: str,
    api_class: str,
    generated_by: str,
    handler_resources: Sequence[str],
    run_time_options: Sequence[tuple[str, str]],
    entry: TargetEntry,
) -> str:
    module = PythonModule(f"The Django boundary of api '{api}': list {api_class}Boundary first in MIDDLEWARE.")
    runtime = module.imported("seampact.django.runtime", "_django_runtime")
    contract = module.imported(".contract", "_contract")
    settings = module.imported(".settings", "_settings")
    resources = ", ".join(string_literal(resource) for resource in handler_resources)
    module.add_block(
        [
            f"class {api_class}Boundary({runtime}.ContractBoundary):",
            f'{INDENT}"""The boundary middleware of api \'{api}\'."""',
            "",
            f"{INDENT}api = {string_literal(api)}",
            f"{INDENT}generated_by = {string_literal(generated_by)}",
            f"{INDENT}contract = {contract}.CONTRACT",
            f"{INDENT}settings_keys = {settings}.SETTINGS_KEYS",
            f"{INDENT}handler_resources = ({resources}{',' if len(handler_resources) == 1 else ''})",
            *(f"{INDENT}{attribute} = {literal}" for attribute, literal in run_time_options),
            *_tuple_attribute("frameworks", _accepted_frameworks(runtime, entry)),
            *_tuple_attribute("framework_routes", _framework_routes(runtime, entry.framework_routes)),
        ]
    )

    return module.text()


def _accepted_frameworks(runtime: str, entry: TargetEntry) -> list[str]:
    """The matrix row's frameworks, each by its unit, with the entry's `allowUntested` units."""
    lines: list[str] = []

    for framework in entry.matrix.frameworks if entry.matrix is not None else ():
        units = ", ".join(string_literal(unit) for unit in framework.accepted_units(entry.allow_untested))
        arguments = [
            f"package={string_literal(framework.package)}",
            f"unit={runtime}.VersionUnit.{framework.unit.name}",
            f"accepted=({units}{',' if len(framework.accepted_units(entry.allow_untested)) == 1 else ''})",
        ]
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

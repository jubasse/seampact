"""The `django` module of one api: the declaration of its boundary middleware (ADR 0027 "The boundary middleware"),
which the app lists first in `MIDDLEWARE` as `<package>.django.<Api>Boundary`. It records the api, the version of
the generator, the api's contract and settings keys, its handler resources, the framework majors `generate`
accepted, the entry's `frameworkRoutes`, and the target options the boundary reads at run time, each a Python
literal."""

from collections.abc import Mapping, Sequence

from seampact.codegen.printer import INDENT, PythonModule, bracketed, string_literal
from seampact.ir.run.generator import FrameworkRoute, TargetEntry


def boundary_module(
    api: str,
    api_class: str,
    generated_by: str,
    handler_resources: Mapping[str, Sequence[str]],
    run_time_options: Sequence[tuple[str, str]],
    entry: TargetEntry,
) -> str:
    module = PythonModule(f"The Django boundary of api '{api}': list {api_class}Boundary first in MIDDLEWARE.")
    runtime = module.imported("seampact.django.runtime", "_django_runtime")
    contract = module.imported(".contract", "_contract")
    settings = module.imported(".settings", "_settings")
    module.add_block(
        [
            f"class {api_class}Boundary({runtime}.ContractBoundary):",
            f'{INDENT}"""The boundary middleware of api \'{api}\'."""',
            "",
            f"{INDENT}api = {string_literal(api)}",
            f"{INDENT}generated_by = {string_literal(generated_by)}",
            f"{INDENT}contract = {contract}.CONTRACT",
            f"{INDENT}settings_keys = {settings}.SETTINGS_KEYS",
            *_handler_resources(module, handler_resources),
            *(f"{INDENT}{attribute} = {literal}" for attribute, literal in run_time_options),
            *_tuple_attribute("frameworks", _accepted_frameworks(runtime, entry)),
            *_tuple_attribute("framework_routes", _framework_routes(runtime, entry.framework_routes)),
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
            lines.append(f"{INDENT * 2}{head}{_string_tuple(operation_ids)},")
        else:
            lines += bracketed(INDENT * 2, head, [string_literal(item) for item in operation_ids], ",")

    return [*lines, f"{INDENT}}}"]


def _string_tuple(texts: Sequence[str]) -> str:
    literals = [string_literal(text) for text in texts]

    return f"({literals[0]},)" if len(literals) == 1 else f"({', '.join(literals)})"


def _accepted_frameworks(runtime: str, entry: TargetEntry) -> list[str]:
    """The matrix row's frameworks, each by its unit, with the entry's `allowUntested` units and the tested minors."""
    lines: list[str] = []

    for framework in entry.matrix.frameworks if entry.matrix is not None else ():
        arguments = [
            f"package={string_literal(framework.package)}",
            f"unit={runtime}.VersionUnit.{framework.unit.name}",
            f"accepted={_string_tuple(framework.accepted_units(entry.allow_untested))}",
        ]

        if framework.tested_minors:
            arguments.append(f"tested_minors={_string_tuple(framework.tested_minors)}")

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

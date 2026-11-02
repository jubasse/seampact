"""The `django` module of one api: the declaration of its boundary middleware (ADR 0027 "The boundary middleware"),
which the app lists first in `MIDDLEWARE` as `<package>.django.<Api>Boundary`. It records the api, the version of
the generator, the api's contract and settings keys, its handler resources, and the target options the boundary reads
at run time, each a Python literal."""

from collections.abc import Sequence

from seampact.codegen.printer import INDENT, PythonModule, string_literal


def boundary_module(
    api: str,
    api_class: str,
    generated_by: str,
    handler_resources: Sequence[str],
    run_time_options: Sequence[tuple[str, str]],
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
        ]
    )

    return module.text()

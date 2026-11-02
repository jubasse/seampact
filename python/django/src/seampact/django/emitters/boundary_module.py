"""The `django` module of one api: the declaration of its boundary middleware (ADR 0027 "The boundary middleware"),
which the app lists first in `MIDDLEWARE` as `<package>.django.<Api>Boundary`. It records the api, the version of
the generator, and the target options the boundary reads at run time, each a Python literal."""

from collections.abc import Sequence

from seampact.codegen.printer import INDENT, PythonModule, string_literal


def boundary_module(api: str, api_class: str, generated_by: str, run_time_options: Sequence[tuple[str, str]]) -> str:
    module = PythonModule(f"The Django boundary of api '{api}': list {api_class}Boundary first in MIDDLEWARE.")
    runtime = module.imported("seampact.django.runtime", "_django_runtime")
    module.add_block(
        [
            f"class {api_class}Boundary({runtime}.ContractBoundary):",
            f'{INDENT}"""The boundary middleware of api \'{api}\'."""',
            "",
            f"{INDENT}api = {string_literal(api)}",
            f"{INDENT}generated_by = {string_literal(generated_by)}",
            *(f"{INDENT}{attribute} = {literal}" for attribute, literal in run_time_options),
        ]
    )

    return module.text()

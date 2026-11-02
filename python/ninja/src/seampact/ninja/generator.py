"""The `seampact-ninja` generator (ADR 0027 "Ninja"), the class the `seampact.generators` entry point names. Per api it
writes one package: `schemas.py` (the schema models and each operation's input parts, through the shared Pydantic
emitter), `operations.py` (the operation types and endpoints protocols), `contract.py` (the contract the runtime
reads), `routes.py` (the route names and URL builders, unless `routeHelpers: false`), `django.py` (the boundary
middleware's declaration) and `ninja.py` (the placement and `bind_<api>()`). Every refusal is listed at once, and no
file is written when there is one."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.contract_module import contract_module
from seampact.codegen.input_schemas import proof_models, with_input_schemas
from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.matrix_row import refuse_missing_matrix_row
from seampact.codegen.names import api_names
from seampact.codegen.operation_types import operation_types_module
from seampact.codegen.printer import PythonModule
from seampact.codegen.pydantic_forms import refuse_unserved_forms
from seampact.codegen.pydantic_layout import api_layout
from seampact.codegen.pydantic_models import PYDANTIC_MAJOR, PYDANTIC_PACKAGE, pydantic_schemas_module
from seampact.codegen.refusals import Refusals
from seampact.codegen.route_helpers import route_helpers_module
from seampact.codegen.routes import route_table
from seampact.codegen.runtime.version import RUNTIME_VERSION
from seampact.django.emitters import BoundaryBase, boundary_module, contract_paths, routes_named_by_path
from seampact.ir.model import ContractIR
from seampact.ir.naming import IrName, NamingRole, python_identifier
from seampact.ir.read import IrSupport
from seampact.ir.run.generator import TargetEntry
from seampact.ir.write import GeneratedFile
from seampact.ninja.options import ninja_options
from seampact.ninja.placement_module import placement_module

TARGET: Final = "ninja"
DISTRIBUTION: Final = "seampact-ninja"
_HTTP_OPERATION: Final = "httpOperation"
_NAMES_REGISTERED: Final = (
    'The route name of each operation, under the NinjaAPI\'s urls_namespace: reverse "<namespace>:<name>".'
)
_BOUNDARY_BASE: Final = BoundaryBase("seampact.ninja.runtime", "_ninja_runtime", "NinjaContractBoundary")


class NinjaGenerator:
    def ir_support(self) -> IrSupport:
        return IrSupport.of_model(kinds=[_HTTP_OPERATION])

    def framework_docs_off_fix(self) -> str | None:
        return (
            "Remove `frameworkDocs: off` from the entry and switch Ninja's own docs off in the app: "
            "`NinjaAPI(docs_url=None, openapi_url=None)`."
        )

    def generate(self, ir: ContractIR, entry: TargetEntry) -> Sequence[GeneratedFile]:
        refusals = Refusals(entry.id, TARGET, DISTRIBUTION)
        options = ninja_options(TARGET, entry.options, entry.artefacts, refusals)
        mount = entry.mount or ""

        refuse_kept_forms(ir, refusals)
        refuse_missing_matrix_row(entry, refusals, "Django and Django Ninja")
        refuse_unserved_forms(ir, refusals)
        error_codes = sorted({error.code for operation in ir.operations for error in operation.errors})
        layout = api_layout(ir, error_codes, refusals)
        with_inputs = with_input_schemas(ir, layout)
        names = api_names(with_inputs, refusals)
        paths = contract_paths(route_table(ir, mount, refusals), [operation.id for operation in ir.operations])
        routes = routes_named_by_path(paths)
        api_class = python_identifier(IrName(tuple(ir.api.name.segments), NamingRole.SCHEMA))
        files = {
            "__init__.py": PythonModule(f"The generated code of api '{ir.api.id}' for the Ninja target.").text(),
            "schemas.py": pydantic_schemas_module(with_inputs, names, options.rules, refusals),
            "operations.py": operation_types_module(with_inputs, names, layout, refusals),
            "contract.py": contract_module(ir, names, mount, refusals),
            "django.py": boundary_module(
                ir.api.id,
                api_class,
                RUNTIME_VERSION,
                {},
                options.shared.run_time_options(),
                entry,
                base=_BOUNDARY_BASE,
                settings_module=None,
                model_framework=(PYDANTIC_PACKAGE, PYDANTIC_MAJOR),
            ),
            "ninja.py": placement_module(ir, layout, proof_models(layout, names), routes, mount, options.views),
        }

        if options.shared.route_helpers:
            files["routes.py"] = route_helpers_module(ir, routes, refusals, _NAMES_REGISTERED)

        refusals.raise_if_any()

        return [GeneratedFile(path, contents) for path, contents in sorted(files.items())]

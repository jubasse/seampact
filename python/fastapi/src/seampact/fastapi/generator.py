"""The fastapi target (ADR 0026), which `seampact generate` finds through the `seampact.generators` entry point of
`seampact-fastapi`. Per api it writes one package: `schemas.py` (the schema models and each operation's input model,
through the shared Pydantic emitter), `__init__.py` (the operation types), `routes.py` (the route names and URL
builders, unless `routeHelpers: false`) and `fastapi.py` (the placement and `bind_<api>()`). It refuses by name every
option, artefact and contract form it does not serve, all at once."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.names import api_names
from seampact.codegen.pydantic_models import pydantic_schemas_module
from seampact.codegen.refusals import Refusals
from seampact.codegen.route_helpers import route_helpers_module
from seampact.codegen.routes import route_table
from seampact.fastapi.input_schemas import with_input_schemas
from seampact.fastapi.kept_forms import refuse_unserved_forms
from seampact.fastapi.layout import api_layout
from seampact.fastapi.operation_types import operation_types_module
from seampact.fastapi.options import read_options
from seampact.fastapi.placement_module import placement_module
from seampact.ir.model import ContractIR
from seampact.ir.read import IrSupport
from seampact.ir.run.generator import TargetEntry
from seampact.ir.write import GeneratedFile

TARGET: Final = "fastapi"
DISTRIBUTION: Final = "seampact-fastapi"
_HTTP_OPERATION: Final = "httpOperation"


class FastApiGenerator:
    def ir_support(self) -> IrSupport:
        return IrSupport.of_model(kinds=[_HTTP_OPERATION])

    def generate(self, ir: ContractIR, entry: TargetEntry) -> Sequence[GeneratedFile]:
        refusals = Refusals(entry.id, TARGET, DISTRIBUTION)
        options = read_options(entry.options, entry.artefacts, refusals)

        refuse_kept_forms(ir, refusals)
        refuse_unserved_forms(ir, refusals)
        error_codes = sorted({error.code for operation in ir.operations for error in operation.errors})
        layout = api_layout(ir, error_codes, refusals)
        with_inputs = with_input_schemas(ir, layout)
        names = api_names(with_inputs, refusals)
        routes = route_table(ir, entry.mount or "", refusals)
        files = [
            GeneratedFile("schemas.py", pydantic_schemas_module(with_inputs, names, options.rules, refusals)),
            GeneratedFile("__init__.py", operation_types_module(with_inputs, names, layout, refusals)),
            GeneratedFile("fastapi.py", placement_module(ir, layout, routes, options, entry)),
        ]

        if options.route_helpers:
            files.append(GeneratedFile("routes.py", route_helpers_module(ir, routes, refusals)))

        refusals.raise_if_any()

        return sorted(files, key=lambda generated: generated.path)

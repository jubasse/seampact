"""The fastapi target (ADR 0026), which `seampact generate` finds through the `seampact.generators` entry point of
`seampact-fastapi`. Per api it writes one package: `schemas.py` (the schema models and each operation's input model,
through the shared Pydantic emitter), `operations.py` (the operation types), `contract.py` (the contract the runtime
reads, shared with every Python target), `routes.py` (the route names and URL
builders, unless `routeHelpers: false`), `fastapi.py` (the placement and `bind_<api>()`) and, with `nativeDocs`,
`native_docs.json` (seampact's operation objects for FastAPI's document). It refuses by name every
option, artefact and contract form it does not serve, all at once."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.contract_module import contract_module
from seampact.codegen.input_schemas import proof_models, with_input_schemas
from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.matrix_row import refuse_missing_matrix_row
from seampact.codegen.names import api_names
from seampact.codegen.native_docs_file import FrameworkDocument, native_docs_file
from seampact.codegen.operation_types import operation_types_module
from seampact.codegen.printer import PythonModule
from seampact.codegen.pydantic_forms import refuse_unserved_forms
from seampact.codegen.pydantic_layout import api_layout
from seampact.codegen.pydantic_models import pydantic_schemas_module
from seampact.codegen.refusals import Refusals
from seampact.codegen.route_helpers import route_helpers_module
from seampact.codegen.routes import route_table
from seampact.fastapi.options import read_options
from seampact.fastapi.placement_module import placement_module
from seampact.ir.model import ContractIR
from seampact.ir.read import IrSupport
from seampact.ir.run.generator import TargetEntry
from seampact.ir.write import GeneratedFile

TARGET: Final = "fastapi"
DISTRIBUTION: Final = "seampact-fastapi"
_HTTP_OPERATION: Final = "httpOperation"
_FASTAPI_DOCUMENT: Final = FrameworkDocument(TARGET, "FastAPI", ("ValidationError", "HTTPValidationError"))


class FastApiGenerator:
    def ir_support(self) -> IrSupport:
        return IrSupport.of_model(kinds=[_HTTP_OPERATION])

    def framework_docs_off_fix(self) -> str | None:
        return None

    def generate(self, ir: ContractIR, entry: TargetEntry) -> Sequence[GeneratedFile]:
        refusals = Refusals(entry.id, TARGET, DISTRIBUTION)
        options = read_options(entry.options, entry.artefacts, refusals)

        refuse_kept_forms(ir, refusals)

        refuse_missing_matrix_row(entry, refusals, "FastAPI and Starlette")
        refuse_unserved_forms(ir, refusals)
        error_codes = sorted({error.code for operation in ir.operations for error in operation.errors})
        layout = api_layout(ir, error_codes, refusals)
        with_inputs = with_input_schemas(ir, layout)
        names = api_names(with_inputs, refusals)
        routes = route_table(ir, entry.mount or "", refusals)
        files = [
            GeneratedFile("schemas.py", pydantic_schemas_module(with_inputs, names, options.rules, refusals)),
            GeneratedFile(
                "__init__.py", PythonModule(f"The generated code of api '{ir.api.id}' for the FastAPI target.").text()
            ),
            GeneratedFile("operations.py", operation_types_module(with_inputs, names, layout, refusals)),
            GeneratedFile("contract.py", contract_module(ir, names, entry.mount or "", refusals)),
            GeneratedFile(
                "fastapi.py", placement_module(ir, layout, proof_models(layout, names), routes, options, entry)
            ),
        ]

        if options.route_helpers:
            files.append(GeneratedFile("routes.py", route_helpers_module(ir, routes, refusals)))

        if options.native_docs:
            native_docs = native_docs_file(entry.native_docs, layout.operations, _FASTAPI_DOCUMENT, refusals)
            files.extend([] if native_docs is None else [native_docs])

        refusals.raise_if_any()

        return sorted(files, key=lambda generated: generated.path)

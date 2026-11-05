"""The `seampact-drf` generator (ADR 0027 "DRF"), the class the `seampact.generators` entry point names: per api a
package of the schema types, the operation types and handler protocols, the contract the runtime reads, the route
helpers, the URLconf, the typed settings, the boundary's declaration and the DRF placement. Every refusal is listed at
once, and no file is written when there is one."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.contract_module import contract_module
from seampact.codegen.handler_forms import handler_warnings
from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.matrix_row import refuse_missing_matrix_row
from seampact.codegen.names import api_names
from seampact.codegen.printer import PythonModule
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.codegen.route_helpers import route_helpers_module
from seampact.codegen.routes import route_table
from seampact.codegen.runtime.version import RUNTIME_VERSION
from seampact.django.emitters import (
    BoundaryBase,
    ContractPath,
    OptionReader,
    SettingsKey,
    boundary_module,
    contract_paths,
    django_target_options,
    routes_named_by_path,
    settings_module,
    urls_module,
)
from seampact.drf.api_layout import ApiLayout, api_layout
from seampact.drf.dataclass_schemas import dataclass_schemas_module
from seampact.drf.drf_module import drf_module, view_class
from seampact.drf.operation_types import operations_module
from seampact.drf.serializer_fields import RulesMode
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.model import ContractIR, InputMediaType
from seampact.ir.read import IrSupport
from seampact.ir.run.generator import TargetEntry
from seampact.ir.write import GeneratedFile

TARGET: Final = "drf"
DISTRIBUTION: Final = "seampact-drf"

# DRF's own names for the classes an app sets per access kind (ADR 0027 "DRF").
_ACCESS_KEY: Final = SettingsKey("access", "_abc.Mapping[str, _abc.Mapping[str, _abc.Sequence[str]]]")
# The boundary base whose boot check also reads the `access` setting.
_RULES: Final = "rules"
_BOUNDARY_BASE: Final = BoundaryBase("seampact.drf.runtime", "_drf_runtime", "DrfContractBoundary")


class DrfGenerator:
    def ir_support(self) -> IrSupport:
        return IrSupport.of_model(kinds=["httpOperation"])

    def framework_docs_off_fix(self) -> str | None:
        return "Remove `frameworkDocs: off` from the entry and remove the app's own schema view from its URLconf."

    def handler_warnings(self, ir: ContractIR, entry: TargetEntry) -> Sequence[ConfigProblem]:
        return handler_warnings(ir, entry.id)

    def generate(self, ir: ContractIR, entry: TargetEntry) -> Sequence[GeneratedFile]:
        refusals = Refusals(entry.id, TARGET, DISTRIBUTION)
        options = django_target_options(TARGET, (_RULES,), entry.options, entry.artefacts, refusals)
        rules = OptionReader(entry.options, refusals).choice(_RULES, RulesMode.NATIVE)
        refuse_kept_forms(ir, refusals)
        refuse_missing_matrix_row(entry, refusals, "Django and DRF")
        names = api_names(ir, refusals)
        layout = api_layout(ir, refusals)
        routes = route_table(ir, entry.mount or "", refusals)
        paths = contract_paths(routes, [operation.id for operation in ir.operations])
        _refuse_input_media(ir, refusals)

        resources = [owner.key for owner in layout.owners.values()]
        files = {
            "__init__.py": PythonModule(f"The generated code of api '{ir.api.id}' for the DRF target.").text(),
            "schemas.py": dataclass_schemas_module(ir, names, refusals),
            "operations.py": operations_module(ir, names, layout, refusals),
            "contract.py": contract_module(ir, names, entry.mount or "", refusals),
            "urls.py": urls_module(ir.api.id, paths, lambda module, path: _view_of(ir, module, path)),
            "settings.py": settings_module(ir.api.id, layout.api_class, resources, [_ACCESS_KEY]),
            "django.py": boundary_module(
                ir.api.id,
                layout.api_class,
                RUNTIME_VERSION,
                _operations_by_resource(layout),
                options.run_time_options(),
                entry,
                _BOUNDARY_BASE,
            ),
            "drf.py": drf_module(ir, names, layout, paths, rules, refusals),
        }

        if options.route_helpers:
            files["routes.py"] = route_helpers_module(ir, routes_named_by_path(paths), refusals)

        refusals.raise_if_any()

        return [GeneratedFile(path, contents) for path, contents in sorted(files.items())]


def _view_of(ir: ContractIR, module: PythonModule, path: ContractPath) -> str:
    drf = module.imported(".drf", "_drf")
    first = next(operation for operation in ir.operations if operation.id == path.first.operation_id)

    return f"{drf}.{view_class(first)}.as_view()"


def _operations_by_resource(layout: ApiLayout) -> dict[str, list[str]]:
    """Each handler resource's settings key and the operations its handlers serve, in operation order."""
    operations: dict[str, list[str]] = {owner.key: [] for owner in layout.owners.values()}

    for operation_id, names in layout.operations.items():
        operations[names.owner.key].append(operation_id)

    return operations


def _refuse_input_media(ir: ContractIR, refusals: Refusals) -> None:
    for index, operation in enumerate(ir.operations):
        media = operation.input.media if operation.input is not None else InputMediaType.APPLICATION_JSON
        at = IrPlace(f"/operations/{index}/input/media", operation.id)

        if not isinstance(media, InputMediaType):
            refusals.unknown_value(media.raw, at)
        elif media is not InputMediaType.APPLICATION_JSON:
            refusals.waiting("input.media", f"A '{media.value}' request body", at, Delivery.CONSUMER)

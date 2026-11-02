"""The `fastapi` module of an api's package (ADR 0026 "Placement" and "Routes"): `GENERATED_BY`, the api's placement
(its contract routes in registration order, literal segments first, under the entry's `mount`; its contract exception
base; the run-time defaults of the target options; the boot check switches and the entry's framework routes), the
`<Api>HandlerFactories` the app fills with one FastAPI dependency per endpoints protocol, one coroutine per operation
calling its handler method, and `bind_<api>()`, which declares each contract route on the api's router and hands it
to the runtime."""

from collections.abc import Mapping, Sequence
from typing import Final

from seampact.codegen.placement_lines import (
    add_operation_call,
    credentials_types,
    operation_types_arguments,
    tuple_literal,
    unexpected_error_listener,
)
from seampact.codegen.printer import INDENT, PythonModule, bracketed, string_literal
from seampact.codegen.pydantic_layout import ApiLayout
from seampact.codegen.routes import RouteEntry
from seampact.codegen.runtime import RUNTIME_VERSION
from seampact.codegen.source_lines import with_local_imports
from seampact.fastapi.native_docs_file import NATIVE_DOCS_FILE
from seampact.fastapi.options import FastApiOptions
from seampact.ir.model import ContractIR
from seampact.ir.run.generator import FrameworkDocs, TargetEntry

_RUNTIME: Final = "_runtime"
_HOOKS: Final = "_hooks"
_ABC: Final = "_abc"
# Each operation's coroutine: no module alias starts so, whatever the operation's name.
_CALL_PREFIX: Final = "_call_"
_CONTRACT_MODULE: Final = "contract"
_SCHEMAS_MODULE: Final = "schemas"
_PYDANTIC: Final = "pydantic"
_PYDANTIC_MAJOR: Final = "2"
_BIND_DOC: Final = "Places api '{api}' in the app; call it last, after its own middleware and exception handlers."


def placement_module(
    ir: ContractIR,
    layout: ApiLayout,
    proof_models: Mapping[str, str],
    routes: Sequence[RouteEntry],
    options: FastApiOptions,
    entry: TargetEntry,
) -> str:
    """`proof_models` names the `<Op>Proofs` class of the schemas module for each operation whose body has proofs."""
    module = PythonModule(f"The FastAPI placement of api '{ir.api.id}'.")
    module.imported("collections.abc", _ABC)
    module.imported("dataclasses", "_dataclasses")

    if options.native_docs:
        module.imported("pathlib", "_pathlib")

    module.imported("typing", "_typing")
    module.imported("seampact.fastapi.runtime", _RUNTIME)
    module.imported("seampact.hooks", _HOOKS)
    root_names = [layout.contract_error, *(credentials.class_name for credentials in layout.credentials.values())]
    operations = [operation for operation in ir.operations if operation.id in layout.operations]

    for operation in operations:
        names = layout.operations[operation.id]
        root_names += [names.endpoints, names.request, names.result, names.errors, *names.responses.values()]

    head = [f"GENERATED_BY: _typing.Final = {string_literal(RUNTIME_VERSION)}"]
    local_modules = [_CONTRACT_MODULE, _SCHEMAS_MODULE] if proof_models else [_CONTRACT_MODULE]
    module.add_block(with_local_imports(local_modules, root_names, head))
    module.add_block(_placement(ir, layout, routes, options, entry))
    module.add_block(_handler_factories(layout))
    module.add_block(unexpected_error_listener(ir.api.id, _HOOKS, layout))

    for operation in operations:
        names = layout.operations[operation.id]
        module.add_block(
            [
                *bracketed(
                    "",
                    f"async def {_CALL_PREFIX}{names.method}",
                    [f"endpoints: {names.endpoints}", f"request: {names.request}"],
                    f" -> {names.result}:",
                ),
                f"{INDENT}return await {_RUNTIME}.call_handler(endpoints.{names.method}, request)",
            ]
        )

    module.add_block(_bind(ir, layout, proof_models, routes))

    return module.text()


def _placement(
    ir: ContractIR, layout: ApiLayout, routes: Sequence[RouteEntry], options: FastApiOptions, entry: TargetEntry
) -> list[str]:
    route_lines: list[str] = []

    for route in routes:
        methods = tuple_literal(route.methods)
        arguments = [
            string_literal(route.operation_id),
            string_literal(route.name),
            string_literal(route.path()),
            methods,
        ]
        route_lines += bracketed(INDENT * 2, f"{_RUNTIME}.OperationRoute", arguments, ",")

    framework_routes: list[str] = []

    for allowed in entry.framework_routes:
        arguments = [
            f"path={string_literal(allowed.path)}",
            f"method={'None' if allowed.method is None else string_literal(allowed.method)}",
            f"reason={string_literal(allowed.reason)}",
        ]
        framework_routes += bracketed(INDENT * 2, f"{_RUNTIME}.FrameworkRouteRule", arguments, ",")

    boot = options.boot_check
    defaults = options.defaults

    return [
        f"PLACEMENT: _typing.Final = {_RUNTIME}.ApiPlacement(",
        f"{INDENT}api={string_literal(ir.api.id)},",
        f"{INDENT}generated_by=GENERATED_BY,",
        f"{INDENT}mount={string_literal(entry.mount or '')},",
        f"{INDENT}routes=(",
        *route_lines,
        f"{INDENT}),",
        f"{INDENT}error_base={layout.contract_error},",
        *bracketed(
            INDENT,
            f"defaults={_RUNTIME}.TargetDefaults",
            [
                f"responses={_RUNTIME}.ResponsesMode.{defaults.responses.name}",
                f"body_validation={defaults.body_validation}",
                f"framework_etag={_RUNTIME}.FrameworkEtagMode.{defaults.framework_etag.name}",
                f"catch_all={defaults.catch_all}",
            ],
            ",",
        ),
        *bracketed(
            INDENT,
            f"boot_check={_RUNTIME}.BootCheckSwitches",
            [
                f"enabled={boot.enabled}",
                f"framework_routes={_RUNTIME}.FrameworkRoutesCheck.{boot.framework_routes.name}",
                f"hooks={_RUNTIME}.HooksCheck.{boot.hooks.name}",
            ],
            ",",
        ),
        *(
            [f"{INDENT}framework_routes=(),"]
            if not framework_routes
            else [f"{INDENT}framework_routes=(", *framework_routes, f"{INDENT}),"]
        ),
        f"{INDENT}frameworks=(",
        *_accepted_frameworks(entry),
        f"{INDENT}),",
        *credentials_types(_RUNTIME, layout),
        *_framework_document(options, entry),
        ")",
    ]


def _framework_document(options: FastApiOptions, entry: TargetEntry) -> list[str]:
    """`frameworkDocs: off` and `nativeDocs`, each written only when the entry asks for it."""
    lines: list[str] = []

    if entry.framework_docs is FrameworkDocs.OFF:
        lines.append(f"{INDENT}framework_docs={_RUNTIME}.FrameworkDocs.OFF,")

    if options.native_docs:
        native_docs_path = f"_pathlib.Path(__file__).with_name({string_literal(NATIVE_DOCS_FILE)})"
        lines.append(f"{INDENT}native_docs={_RUNTIME}.read_native_docs({native_docs_path}),")

    return lines


def _accepted_frameworks(entry: TargetEntry) -> list[str]:
    """The matrix row's frameworks (FastAPI by minor, Starlette by major) with the entry's `allowUntested` units, then
    Pydantic 2, which the generated models are written for."""
    accepted = [
        (framework.package, framework.unit.name, framework.accepted_units(entry.allow_untested))
        for framework in (entry.matrix.frameworks if entry.matrix is not None else ())
    ]
    accepted.append((_PYDANTIC, "MAJOR", (_PYDANTIC_MAJOR,)))
    lines: list[str] = []

    for package, unit, units in accepted:
        arguments = [
            f"package={string_literal(package)}",
            f"unit={_RUNTIME}.VersionUnit.{unit}",
            f"accepted={tuple_literal(units)}",
        ]
        lines += bracketed(INDENT * 2, f"{_RUNTIME}.AcceptedFramework", arguments, ",")

    return lines


def _handler_factories(layout: ApiLayout) -> list[str]:
    lines = [
        "@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)",
        f"class {layout.handler_factories}:",
        f'{INDENT}"""The FastAPI dependency that builds each endpoints protocol\'s handlers; None fails the boot."""',
        "",
    ]
    lines += [
        f"{INDENT}{attribute}: {_RUNTIME}.Factory[{endpoints}] | None"
        for endpoints, attribute in layout.endpoints_owners().items()
    ]

    return lines


def _bind(
    ir: ContractIR, layout: ApiLayout, proof_models: Mapping[str, str], routes: Sequence[RouteEntry]
) -> list[str]:
    def factories(hook: str) -> str:
        return f"{_ABC}.Mapping[str, {_RUNTIME}.Factory[{_HOOKS}.{hook}]] | None = None"

    parameters = [
        f"target: {_RUNTIME}.BindTarget",
        "*",
        f"handlers: {layout.handler_factories}",
        f"app: {_RUNTIME}.App | None = None",
        f"authenticate: {factories('AuthenticateHook')}",
        f"deciders: {factories('DecideHook')}",
        f"scope_resolvers: {factories('ResolveScopeHook')}",
        f"idempotency_store: {_RUNTIME}.Factory[{_HOOKS}.IdempotencyStore] | None = None",
        f"on_unexpected_error: {_RUNTIME}.Factory[{layout.unexpected_error_listener}] | None = None",
        f"responses: {_RUNTIME}.ResponsesMode | None = None",
        "body_validation: bool | None = None",
        f"operations: {_ABC}.Mapping[str, {_RUNTIME}.OperationSettings] | None = None",
        "public_origin: str | None = None",
    ]
    head = [
        *bracketed("", f"def {layout.bind_function}", parameters, " -> None:"),
        f'{INDENT}"""{_BIND_DOC.format(api=ir.api.id)}"""',
    ]
    lines: list[str] = []

    for route in routes:
        lines += _add_operation(layout, route.operation_id, proof_models.get(route.operation_id))

    hooks = [
        "authenticate=authenticate or {}",
        "deciders=deciders or {}",
        "scope_resolvers=scope_resolvers or {}",
        "idempotency_store=idempotency_store",
        "on_unexpected_error=on_unexpected_error",
    ]
    settings = [
        "responses=responses",
        "body_validation=body_validation",
        "operations=operations or {}",
        "public_origin=public_origin",
    ]

    return [
        *head,
        f"{INDENT}binding = {_RUNTIME}.api_binding(",
        f"{INDENT * 2}PLACEMENT,",
        f"{INDENT * 2}_{_CONTRACT_MODULE}.CONTRACT,",
        f"{INDENT * 2}target,",
        f"{INDENT * 2}app=app,",
        *bracketed(INDENT * 2, f"hooks={_RUNTIME}.HookFactories", hooks, ","),
        *bracketed(INDENT * 2, f"settings={_RUNTIME}.RunSettings", settings, ","),
        f"{INDENT})",
        "",
        *lines,
        "",
        f"{INDENT}{_RUNTIME}.bind_api(binding)",
    ]


def _add_operation(layout: ApiLayout, operation_id: str, proof_model: str | None) -> list[str]:
    """One `add_operation` call, split as ruff splits it: the call on one line when it fits, else one argument per
    line, the operation's types a nested call split the same way."""
    names = layout.operations[operation_id]
    proofs = None if proof_model is None else f"_{_SCHEMAS_MODULE}.{proof_model}"
    types = operation_types_arguments(layout, operation_id, proofs)
    arguments = [
        "binding",
        string_literal(operation_id),
        f"handlers.{names.owner_attribute}",
        f"{_CALL_PREFIX}{names.method}",
    ]

    return add_operation_call(_RUNTIME, arguments, types)

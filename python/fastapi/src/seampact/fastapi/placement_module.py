"""The `fastapi` module of an api's package (ADR 0026 "Placement" and "Routes"): `GENERATED_BY`, the api's placement
(its contract routes in registration order, literal segments first, under the entry's `mount`; its contract exception
base; the run-time defaults of the target options; the boot check switches and the entry's framework routes), the
`<Api>HandlerFactories` the app fills with one FastAPI dependency per endpoints protocol, one coroutine per operation
calling its handler method, and `bind_<api>()`, which declares each contract route on the api's router and hands it
to the runtime."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.printer import INDENT, PythonModule, string_literal
from seampact.codegen.routes import RouteEntry
from seampact.codegen.runtime import RUNTIME_VERSION
from seampact.fastapi.layout import ApiLayout
from seampact.fastapi.options import FastApiOptions
from seampact.fastapi.source_lines import bracketed, with_local_imports
from seampact.ir.model import ContractIR
from seampact.ir.run.generator import TargetEntry

_RUNTIME: Final = "_runtime"
_HOOKS: Final = "_hooks"
_ABC: Final = "_abc"
_BIND_DOC: Final = "Places api '{api}' in the app; call it last, after its own middleware and exception handlers."


def placement_module(
    ir: ContractIR, layout: ApiLayout, routes: Sequence[RouteEntry], options: FastApiOptions, entry: TargetEntry
) -> str:
    module = PythonModule(f"The FastAPI placement of api '{ir.api.id}'.")
    module.imported("collections.abc", _ABC)
    module.imported("dataclasses", "_dataclasses")
    module.imported("typing", "_typing")
    module.imported("seampact.fastapi.runtime", _RUNTIME)
    module.imported("seampact.hooks", _HOOKS)
    root_names = [layout.contract_error]
    operations = [operation for operation in ir.operations if operation.id in layout.operations]

    for operation in operations:
        names = layout.operations[operation.id]
        root_names += [names.endpoints, names.request, names.result]

    head = [f"GENERATED_BY: _typing.Final = {string_literal(RUNTIME_VERSION)}"]
    module.add_block(with_local_imports([], root_names, head))
    module.add_block(_placement(ir, layout, routes, options, entry))
    module.add_block(_handler_factories(layout))

    for operation in operations:
        names = layout.operations[operation.id]
        module.add_block(
            [
                *bracketed(
                    "",
                    f"async def _{names.method}",
                    [f"endpoints: {names.endpoints}", f"request: {names.request}"],
                    f" -> {names.result}:",
                ),
                f"{INDENT}return await {_RUNTIME}.call_handler(endpoints.{names.method}, request)",
            ]
        )

    module.add_block(_bind(ir, layout, routes))

    return module.text()


def _placement(
    ir: ContractIR, layout: ApiLayout, routes: Sequence[RouteEntry], options: FastApiOptions, entry: TargetEntry
) -> list[str]:
    route_lines: list[str] = []

    for route in routes:
        methods = (
            "("
            + ", ".join(string_literal(method) for method in route.methods)
            + ("," if len(route.methods) == 1 else "")
            + ")"
        )
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
        ")",
    ]


def _handler_factories(layout: ApiLayout) -> list[str]:
    lines = [
        "@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)",
        f"class {layout.handler_factories}:",
        f'{INDENT}"""The FastAPI dependency that builds the handlers of each endpoints protocol."""',
        "",
    ]
    lines += [
        f"{INDENT}{attribute}: {_RUNTIME}.Factory[{endpoints}]"
        for endpoints, attribute in layout.endpoints_owners().items()
    ]

    return lines


def _bind(ir: ContractIR, layout: ApiLayout, routes: Sequence[RouteEntry]) -> list[str]:
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
        f"on_unexpected_error: {_RUNTIME}.Factory[object] | None = None",
        f"responses: {_RUNTIME}.ResponsesMode | None = None",
        "body_validation: bool | None = None",
        f"operations: {_ABC}.Mapping[str, {_RUNTIME}.OperationSettings] | None = None",
        "public_origin: str | None = None",
    ]
    lines = [
        *bracketed("", f"def {layout.bind_function}", parameters, " -> None:"),
        f'{INDENT}"""{_BIND_DOC.format(api=ir.api.id)}"""',
        f"{INDENT}router = {_RUNTIME}.contract_router()",
        "",
    ]

    for route in routes:
        names = layout.operations[route.operation_id]
        arguments = [
            "router",
            "PLACEMENT",
            string_literal(route.operation_id),
            f"handlers.{names.owner_attribute}",
            f"_{names.method}",
        ]
        lines += bracketed(INDENT, f"{_RUNTIME}.add_operation", arguments, "")

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
        *lines,
        "",
        f"{INDENT}{_RUNTIME}.bind_api(",
        f"{INDENT * 2}PLACEMENT,",
        f"{INDENT * 2}target,",
        f"{INDENT * 2}router,",
        f"{INDENT * 2}app=app,",
        *bracketed(INDENT * 2, f"hooks={_RUNTIME}.HookFactories", hooks, ","),
        *bracketed(INDENT * 2, f"settings={_RUNTIME}.RunSettings", settings, ","),
        f"{INDENT})",
    ]

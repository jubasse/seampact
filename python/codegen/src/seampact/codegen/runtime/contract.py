"""The api's contract as the boundary reads it: the IR view of the kept operations and the declarations they read,
which the generated code holds as JSON values, the Python names of each schema's members, and the routes, built once
per process."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final

from seampact.codegen.runtime.ir_view import IrJson, IrMap, ir_int, ir_map, ir_maps, ir_string
from seampact.codegen.runtime.route_match import ContractRoute, RouteMatch, most_specific_first

NOT_FOUND_ROLE: Final = "notFound"
# The role a framework's HTTP error takes on a contract route, by its status; another status has no role.
ROLE_OF_STATUS: Final[Mapping[int, str]] = {
    401: "unauthenticated",
    403: "forbidden",
    404: NOT_FOUND_ROLE,
    413: "payloadTooLarge",
    429: "rateLimited",
    503: "serviceUnavailable",
}
UNDECLARED_STATUS_ROLE: Final = "undeclaredStatus"
INTERNAL_STATUS: Final = 500

PATH_PART: Final = "path"
QUERY_PART: Final = "query"
HEADER_PART: Final = "header"
PROOFS_PART: Final = "proofs"
"""The parts of an operation's input whose wire names `operation_members` maps: its path, query and header
parameters (the credential and CSRF headers stay the boundary's), and the rule proofs read in its body. The header
part is spelled as the IR spells it."""
_KNOWN_PARTS: Final = (PATH_PART, QUERY_PART, HEADER_PART, PROOFS_PART)

_IGNORE_POLICY: Final = "ignore"
_REFUSE_POLICY: Final = "refuse"
_HEAD: Final = "HEAD"
_GET: Final = "GET"


@dataclass(frozen=True, slots=True)
class ApiContract:
    """`ir_view` is the IR's JSON subset the generator wrote (`api`, `formats`, `errors`, `schemas`, `enums`,
    `operations`, and the access declarations `identities`, `schemes`, `scopes`, `rights`, `rules`, `buckets` and
    `pagings`); `members` maps each schema id to its members' wire names and Python attribute names;
    `operation_members` maps each operation id, then each part of its input, to the same; `params_models` maps the
    params schema id of each right and rule to its generated class; `mount` is the entry's prefix of every contract
    path, empty for none."""

    api: str
    generated_by: str
    mount: str
    ir_view: Mapping[str, IrJson]
    members: Mapping[str, Mapping[str, str]]
    operation_members: Mapping[str, Mapping[str, Mapping[str, str]]]
    params_models: Mapping[str, type] = field(default_factory=dict[str, type])
    _operations: dict[str, IrMap] = field(init=False, repr=False)
    _routes: tuple[ContractRoute, ...] = field(init=False, repr=False)
    _base_paths: tuple[str, ...] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        operations: dict[str, IrMap] = {}
        routes: list[ContractRoute] = []
        base_paths: list[str] = []
        surfaces = ir_map(ir_map(self.ir_view, "api"), "surfaces")

        for operation in ir_maps(self.ir_view, "operations"):
            operation_id = ir_string(operation, "id") or ""
            base_path = self.mount + (
                ir_string(ir_map(surfaces, ir_string(operation, "surface") or ""), "prefix") or ""
            )
            template = self.mount + (ir_string(operation, "path") or "")
            operations[operation_id] = operation
            routes.append(ContractRoute.of(operation_id, ir_string(operation, "method") or "", template, base_path))

            if base_path not in base_paths:
                base_paths.append(base_path)

        object.__setattr__(self, "_operations", operations)
        object.__setattr__(self, "_routes", tuple(most_specific_first(routes)))
        object.__setattr__(self, "_base_paths", tuple(base_paths))

    def operation(self, operation_id: str) -> IrMap:
        """Raises `LookupError` for an operation the api does not keep."""
        operation = self._operations.get(operation_id)

        if operation is None:
            raise LookupError(f"The api '{self.api}' has no operation '{operation_id}'.")

        return operation

    def part_members(self, operation_id: str, part: str) -> Mapping[str, str]:
        """The wire names of one part of the operation's input and their Python attributes, empty for a part it does not
        have. Raises `ValueError` for a part name that is none of the known parts."""
        if part not in _KNOWN_PARTS:
            raise ValueError(
                f"Unknown part '{part}' of an operation's input; the known parts are {', '.join(_KNOWN_PARTS)}."
            )

        self.operation(operation_id)

        return self.operation_members.get(operation_id, {}).get(part, {})

    def ignores_unknown_query(self, operation_id: str) -> bool:
        """Whether the operation ignores the query keys it does not declare, rather than refusing them."""
        return ir_string(ir_map(self.operation(operation_id), "unknownQuery"), "policy") == _IGNORE_POLICY

    def unknown_keys_policy(self, operation_id: str) -> str:
        """`refuse`, `ignore` or `keep`: what the operation's body does with a key its schema does not declare; the
        names of the body's rule proofs are declared keys."""
        input_use = ir_map(ir_map(self.operation(operation_id), "input"), "schema")

        return ir_string(ir_map(input_use, "unknownKeys"), "policy") or _REFUSE_POLICY

    def operation_ids(self) -> list[str]:
        return list(self._operations)

    def base_paths(self) -> tuple[str, ...]:
        return self._base_paths

    def match(self, method: str, raw_path: str) -> RouteMatch | None:
        """The operation the raw path matches; an unserved match for a path under a base path that no route serves
        with this method; None for a path under none of the api's base paths."""
        if not any(_under(raw_path, base_path) for base_path in self._base_paths):
            return None

        route_method = _GET if method.upper() == _HEAD else method.upper()
        segments = raw_path.split("/")[1:]

        for route in self._routes:
            parameters = route.match(segments)

            if parameters is not None and route.method == route_method:
                return RouteMatch(route.operation_id, parameters)

        return RouteMatch(None, {})

    def route_name(self, operation_id: str) -> str:
        """The name the generated route declaration gives an operation."""
        return f"seampact.{self.api}.{operation_id}"

    def role_code(self, operation_id: str | None, role: str) -> str | None:
        """The code an operation declares for `role`, else a catalogued code whose default role it is and that the
        operation declares; with no operation, the first code any operation declares for the role."""
        operations = list(self._operations.values()) if operation_id is None else [self.operation(operation_id)]

        for operation in operations:
            for error in ir_maps(operation, "errors"):
                if any(ir_string(declared, "role") == role for declared in ir_maps(error, "roles")):
                    return ir_string(error, "code")

        if operation_id is None:
            return None

        for code, catalogued in ir_map(self.ir_view, "errors").items():
            if ir_string(catalogued, "default") == role and self.declares(operation_id, code):
                return code

        return None

    def role_params(self, operation_id: str, code: str, role: str) -> object:
        """The params template a role binds on one of the operation's codes, None when it binds none."""
        for declared in ir_maps(self.error_declaration(operation_id, code), "roles"):
            if ir_string(declared, "role") == role:
                return declared.get("params")

        return None

    def error_declaration(self, operation_id: str, code: str) -> IrMap:
        """The operation's entry for `code` (its roles and retry header), empty when it declares none."""
        for error in ir_maps(self.operation(operation_id), "errors"):
            if ir_string(error, "code") == code:
                return error

        return {}

    def declares(self, operation_id: str, code: str) -> bool:
        return bool(self.error_declaration(operation_id, code))

    def catalog_entry(self, code: str) -> IrMap:
        return ir_map(ir_map(self.ir_view, "errors"), code)

    def status_of(self, code: str) -> int:
        return ir_int(ir_map(self.catalog_entry(code), "http"), "status") or INTERNAL_STATUS

    def declared_codes(self, operation_id: str, status: int) -> list[str]:
        """The operation's codes answered with `status`."""
        codes = [ir_string(error, "code") for error in ir_maps(self.operation(operation_id), "errors")]

        return [code for code in codes if code is not None and self.status_of(code) == status]

    def format(self, operation_id: str | None) -> IrMap:
        """The wire format an operation answers in; the api's first format when no operation matched."""
        formats = ir_map(self.ir_view, "formats")
        format_id = None if operation_id is None else ir_string(self.operation(operation_id), "format")

        if format_id is None:
            format_id = next(iter(formats), "")

        return ir_map(formats, format_id)

    def declaration(self, kind: str, declaration_id: str) -> IrMap:
        return ir_map(ir_map(self.ir_view, kind), declaration_id)


def _under(raw_path: str, base_path: str) -> bool:
    return base_path == "" or raw_path == base_path or raw_path.startswith(base_path + "/")

"""The `contract` module every Python target writes, on the reference contract: imported, its `CONTRACT` holds the IR
view as the IR's JSON writes it, and the Python attribute of each member's wire name. The FastAPI and DRF golden
packages pin its text."""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Final

import pytest

from seampact.codegen.contract_module import CONTRACT_NAME, IR_VIEW_MEMBERS, contract_module
from seampact.codegen.names import api_names
from seampact.codegen.printer import literal_lines
from seampact.codegen.refusals import Refusals
from seampact.codegen.runtime.contract import HEADER_PART, PATH_PART, PROOFS_PART, QUERY_PART, ApiContract
from seampact.codegen.runtime.ir_view import IrJson
from seampact.ir.read import IrSupport, read_ir

_PER_OPERATION: Final = (
    "access",
    "callerKinds",
    "principalRequires",
    "scopes",
    "requires",
    "idempotency",
    "paging",
    "relays",
    "cache",
    "unknownQuery",
    "input",
)
_CREDENTIAL_DERIVATION: Final = "identity.authenticate"
_CSRF_DERIVATION_PREFIX: Final = "csrf."


def _ir_json(repository_root: Path, api: str) -> dict[str, object]:
    document: dict[str, object] = json.loads(
        (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8")
    )

    return document


def _imported_contract(repository_root: Path, api: str) -> ApiContract:
    ir = read_ir(json.dumps(_ir_json(repository_root, api)), IrSupport.of_model(kinds=["httpOperation"]))
    refusals = Refusals("reference", "python", "seampact-codegen")
    text = contract_module(ir, api_names(ir, refusals), "", refusals)
    namespace: dict[str, object] = {}

    assert refusals.is_empty()
    exec(compile(text, f"<contract of {api}>", "exec"), namespace)
    contract = namespace[CONTRACT_NAME]
    assert isinstance(contract, ApiContract)

    return contract


def _map(node: object, key: str) -> Mapping[str, object]:
    assert isinstance(node, Mapping)
    value = node.get(key, {})
    assert isinstance(value, Mapping)

    return value


def _maps(node: object, key: str) -> list[Mapping[str, object]]:
    assert isinstance(node, Mapping)
    items = node.get(key, [])
    assert isinstance(items, list)

    return [item for item in items if isinstance(item, Mapping)]


def _names(items: list[Mapping[str, object]]) -> list[object]:
    return [item["name"] for item in items]


@pytest.mark.parametrize("api", ["tasks", "tasksService"])
def test_the_ir_view_is_the_ir_of_the_kept_operations_and_their_declarations(repository_root: Path, api: str) -> None:
    document = _ir_json(repository_root, api)
    contract = _imported_contract(repository_root, api)

    assert dict(contract.ir_view) == {
        **{member: document.get(member, {}) for member in IR_VIEW_MEMBERS},
        "operations": document["operations"],
    }

    for operation in _maps(document, "operations"):
        viewed = contract.operation(str(operation["id"]))

        for member in _PER_OPERATION:
            assert viewed.get(member) == operation.get(member), f"{operation['id']} {member}"


@pytest.mark.parametrize("api", ["tasks", "tasksService"])
def test_every_wire_name_has_its_python_attribute(repository_root: Path, api: str) -> None:
    document = _ir_json(repository_root, api)
    contract = _imported_contract(repository_root, api)
    schemas = _map(document, "schemas")

    for schema_id in schemas:
        schema = _map(schemas, schema_id)

        if schema["kind"] == "object":
            assert list(contract.members[schema_id]) == _names(_maps(schema, "properties"))

    for operation in _maps(document, "operations"):
        operation_id = str(operation["id"])
        params = _map(operation, "params")
        handler_headers = [header for header in _maps(params, "header") if _reaches_the_handler(header)]

        assert list(contract.part_members(operation_id, PATH_PART)) == _names(_maps(params, "path"))
        assert list(contract.part_members(operation_id, QUERY_PART)) == _names(_maps(params, "query"))
        assert list(contract.part_members(operation_id, HEADER_PART)) == _names(handler_headers)
        assert list(contract.part_members(operation_id, PROOFS_PART)) == _names(
            _maps(_map(operation, "input"), "proofs")
        )


@pytest.mark.parametrize("api", ["tasks", "tasksService"])
def test_the_policies_read_as_the_ir_states_them(repository_root: Path, api: str) -> None:
    document = _ir_json(repository_root, api)
    contract = _imported_contract(repository_root, api)

    for operation in _maps(document, "operations"):
        operation_id = str(operation["id"])
        unknown_keys = _map(_map(_map(operation, "input"), "schema"), "unknownKeys")

        assert contract.ignores_unknown_query(operation_id) == (_map(operation, "unknownQuery")["policy"] == "ignore")
        assert contract.unknown_keys_policy(operation_id) == unknown_keys.get("policy", "refuse")


def _reaches_the_handler(header: Mapping[str, object]) -> bool:
    derived_from = header.get("derivedFrom")

    if not isinstance(derived_from, Mapping):
        return True

    derivation = str(derived_from.get("derivation"))

    return derivation != _CREDENTIAL_DERIVATION and not derivation.startswith(_CSRF_DERIVATION_PREFIX)


def _hand_built_contract(*, unknown_query: str, unknown_keys: dict[str, IrJson]) -> ApiContract:
    operation: dict[str, IrJson] = {
        "id": "list",
        "method": "GET",
        "path": "/items",
        "surface": "public",
        "unknownQuery": {"policy": unknown_query},
        "input": {"schema": {"unknownKeys": unknown_keys}},
    }

    return ApiContract(
        api="items",
        generated_by="test",
        mount="",
        ir_view={"api": {"surfaces": {"public": {"prefix": ""}}}, "operations": [operation]},
        members={},
        operation_members={"list": {PATH_PART: {"id": "id"}}},
    )


@pytest.mark.parametrize(("policy", "ignored"), [("ignore", True), ("refuse", False)])
def test_the_unknown_query_policy_ignores_only_when_the_operation_says_ignore(policy: str, ignored: bool) -> None:
    contract = _hand_built_contract(unknown_query=policy, unknown_keys={})

    assert contract.ignores_unknown_query("list") is ignored


@pytest.mark.parametrize("policy", ["ignore", "keep", "refuse"])
def test_the_unknown_keys_policy_is_the_one_the_operation_declares(policy: str) -> None:
    contract = _hand_built_contract(unknown_query="refuse", unknown_keys={"policy": policy})

    assert contract.unknown_keys_policy("list") == policy


def test_the_unknown_keys_policy_defaults_to_refuse() -> None:
    contract = _hand_built_contract(unknown_query="refuse", unknown_keys={})

    assert contract.unknown_keys_policy("list") == "refuse"


def test_an_unknown_part_name_is_refused_naming_the_known_parts() -> None:
    contract = _hand_built_contract(unknown_query="refuse", unknown_keys={})

    with pytest.raises(ValueError, match=r"Unknown part 'headers'.*path, query, header, proofs"):
        contract.part_members("list", "headers")

    assert dict(contract.part_members("list", PATH_PART)) == {"id": "id"}
    assert dict(contract.part_members("list", HEADER_PART)) == {}


def test_a_literal_reads_back_as_the_value_it_was_written_from() -> None:
    value = {
        "quotes": ['say "hi"', "it's", "\"both\" 'kinds'"],
        "escapes": "line\nbreak\ttab\\slash\x00nul\x7fdel",
        "beyond ascii": "café \U0001f600 \ud800",
        "long": "word " * 40 + "/a/very/long/pointer" * 8,
        "numbers": [0, -7, 1.5, 12345678901234567890],
        "flags": [True, False, None],
        "empty": [{}, []],
    }

    text = "\n".join(literal_lines("", "VALUE = ", value, ""))

    assert all(len(line) <= 120 for line in text.splitlines())
    assert eval(text.removeprefix("VALUE = ")) == value

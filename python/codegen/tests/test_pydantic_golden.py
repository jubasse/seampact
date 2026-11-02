"""The Pydantic emitter and the route helpers on the reference contract, against their golden files, which ruff,
`mypy --strict` with the Pydantic plugin and pyright strict check as the generated code of an app. Set
`SEAMPACT_UPDATE_GOLDEN=1` to write them again."""

import json
import os
from pathlib import Path

import pytest

from seampact.codegen.names import api_names
from seampact.codegen.pydantic_models import RulesMode, pydantic_schemas_module
from seampact.codegen.refusals import Refusals
from seampact.codegen.route_helpers import route_helpers_module
from seampact.codegen.routes import route_table
from seampact.ir.model import ContractIR
from seampact.ir.read import IrSupport, read_ir
from seampact.ir.run.generator import GenerationRefusedError

_GOLDEN = Path(__file__).parent / "golden" / "reference"
_UPDATE = os.environ.get("SEAMPACT_UPDATE_GOLDEN") == "1"


def _contract(repository_root: Path, api: str) -> ContractIR:
    text = (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8")

    return read_ir(text, IrSupport.of_model(kinds=["httpOperation"]))


def _check(path: Path, generated: str) -> None:
    if _UPDATE:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(generated, encoding="utf-8")

    assert generated == path.read_text(encoding="utf-8"), f"{path} differs; run with SEAMPACT_UPDATE_GOLDEN=1"


@pytest.mark.parametrize(
    ("api", "rules", "package"),
    [
        ("tasks", RulesMode.NATIVE, "tasks"),
        ("tasks", RulesMode.SEAMPACT_CONSISTENT, "tasks_consistent"),
        ("tasksService", RulesMode.NATIVE, "tasks_service"),
    ],
)
def test_the_reference_schemas_match_their_golden_module(
    repository_root: Path, api: str, rules: RulesMode, package: str
) -> None:
    ir = _contract(repository_root, api)
    refusals = Refusals("reference", "pydantic", "seampact-codegen")
    generated = pydantic_schemas_module(ir, api_names(ir, refusals), rules, refusals)

    refusals.raise_if_any()
    _check(_GOLDEN / package / "schemas.py", generated)


def test_the_reference_route_helpers_match_their_golden_module(repository_root: Path) -> None:
    ir = _contract(repository_root, "tasks")
    refusals = Refusals("reference", "pydantic", "seampact-codegen")
    routes = route_table(ir, "", refusals)
    generated = route_helpers_module(ir, routes, refusals)

    refusals.raise_if_any()
    assert [route.path() for route in routes][:3] == ["/v1/health", "/v1/channels", "/v1/me/preferences"]
    _check(_GOLDEN / "tasks" / "routes.py", generated)


def test_literal_segments_come_before_placeholders_at_each_depth(repository_root: Path) -> None:
    routes = route_table(_contract(repository_root, "tasks"), "/api", Refusals("reference", "pydantic", "x"))
    paths = [route.path() for route in routes]

    assert paths.index("/api/v1/channels/{channel_id}/tasks/search") < paths.index(
        "/api/v1/channels/{channel_id}/tasks/{task_id}"
    )
    assert next(route for route in routes if route.operation_id == "getTask").methods == ("GET", "HEAD")


def test_two_members_with_one_python_name_are_refused_naming_both(repository_root: Path) -> None:
    ir_json = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))
    properties = ir_json["schemas"]["Task"]["properties"]
    properties[:2] = [{**properties[0], "name": "2fa"}, {**properties[0], "name": "field_2fa"}]
    refusals = Refusals("reference", "pydantic", "seampact-codegen")

    api_names(read_ir(json.dumps(ir_json), IrSupport.of_model(kinds=["httpOperation"])), refusals)

    with pytest.raises(GenerationRefusedError, match=r"name\.collision") as refused:
        refusals.raise_if_any()

    assert "/schemas/Task/properties/0" in str(refused.value)
    assert "/schemas/Task/properties/1" in str(refused.value)

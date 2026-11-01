"""Each target entry's view of the IR: the apis it names, its document, its include and exclude lists."""

from seampact.ir.config import AppConfigEntry, SourceApi, entry_view
from seampact.ir.config.json_value import JsonObject


def _entry(**members: object) -> AppConfigEntry:
    entry: JsonObject = {"id": "main", "use": "pypi:seampact-fastapi", **members}  # type: ignore[dict-item]

    return AppConfigEntry(entry, "/out/main")


def _api(source: str, name: str) -> SourceApi:
    ir: JsonObject = {
        "api": {"id": name, "documents": {"public": {"surfaces": ["public"], "internal": "exclude"}}},
        "operations": [
            {"id": "listTasks", "surface": "public", "tags": ["tasks"]},
            {"id": "createTask", "surface": "public", "tags": ["tasks", "write"]},
            {"id": "audit", "surface": "internal", "tags": ["ops"]},
            {"id": "hidden", "surface": "public", "internal": True, "tags": []},
        ],
    }

    return SourceApi(source, name, ir)


def _kept(result_ir: JsonObject) -> list[str]:
    operations = result_ir["operations"]
    assert isinstance(operations, list)

    return [operation["id"] for operation in operations if isinstance(operation, dict)]  # type: ignore[misc]


def test_an_entry_without_a_selection_keeps_every_operation_and_leaves_the_source_alone() -> None:
    source = _api("contract", "tasks")
    result = entry_view(_entry(api="tasks"), [source])

    assert result.problems == []
    assert _kept(result.apis[0].ir) == ["listTasks", "createTask", "audit", "hidden"]
    assert _kept(source.ir) == ["listTasks", "createTask", "audit", "hidden"]


def test_a_document_keeps_its_surfaces_and_drops_internal_operations() -> None:
    result = entry_view(_entry(api="tasks", document="public"), [_api("contract", "tasks")])

    assert _kept(result.apis[0].ir) == ["listTasks", "createTask"]


def test_include_and_exclude_match_an_operation_id_or_a_tag() -> None:
    entry = _entry(api="tasks", operations={"include": ["tasks"], "exclude": ["write"]})
    result = entry_view(entry, [_api("contract", "tasks")])

    assert _kept(result.apis[0].ir) == ["listTasks"]


def test_an_api_named_alone_in_two_sources_is_ambiguous_and_a_source_prefix_picks_one() -> None:
    apis = [_api("one", "tasks"), _api("two", "tasks")]

    ambiguous = entry_view(_entry(api="tasks"), apis)
    picked = entry_view(_entry(api="two/tasks"), apis)

    assert [problem.code for problem in ambiguous.problems] == ["config.api.ambiguous"]
    assert [api.source for api in picked.apis] == ["two"]


def test_unknown_names_are_refused_by_name() -> None:
    apis = [_api("contract", "tasks")]
    unknown_api = entry_view(_entry(api="nothing"), apis)
    unknown_document = entry_view(_entry(api="tasks", document="private"), apis)
    unknown_item = entry_view(_entry(api="tasks", operations={"include": ["nope"]}), apis)
    removed = entry_view(_entry(api="tasks", document="public", operations={"include": ["audit"]}), apis)

    assert [problem.code for problem in unknown_api.problems] == ["config.api.unknown"]
    assert [problem.code for problem in unknown_document.problems] == ["filter.document.unknown"]
    assert [problem.code for problem in unknown_item.problems] == ["filter.operation.unknown"]
    assert [problem.code for problem in removed.problems] == ["filter.include.removed"]


def test_apis_with_the_same_name_in_one_entry_are_refused() -> None:
    apis = [_api("one", "tasks"), _api("two", "tasks")]
    result = entry_view(_entry(apis=["one/tasks", "two/tasks"]), apis)

    assert [problem.code for problem in result.problems] == ["config.api.duplicate"]

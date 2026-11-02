"""The document `nativeDocs` follows: the entry's `document`, else the one declared document holding every route the
entry generates (ADR 0011), else a refusal."""

from seampact.ir.config import AppConfigEntry, ConfigProblem, SourceApi
from seampact.ir.config.json_value import JsonObject
from seampact.ir.run.native_docs_document import _chosen_document

_DOCUMENTS: JsonObject = {
    "public": {"surfaces": ["public"]},
    "full": {"surfaces": ["public", "internal"]},
}


def _entry(document: str | None = None) -> AppConfigEntry:
    entry: JsonObject = {"id": "main", "use": "pypi:seampact-fastapi"}

    if document is not None:
        entry["document"] = document

    return AppConfigEntry(entry, "/out/main")


def _api(*surfaces: str) -> SourceApi:
    operations: list[JsonObject] = [
        {"id": f"operation{index}", "surface": surface} for index, surface in enumerate(surfaces)
    ]
    ir: JsonObject = {"api": {"id": "tasks", "documents": _DOCUMENTS}, "operations": list(operations)}

    return SourceApi("contract", "tasks", ir)


def test_the_one_declared_document_holding_every_route_is_chosen() -> None:
    assert _chosen_document(_entry(), _api("public", "internal"), _DOCUMENTS) == "full"


def test_the_entrys_document_is_chosen_without_looking() -> None:
    assert _chosen_document(_entry("public"), _api("public", "internal"), _DOCUMENTS) == "public"


def test_several_documents_holding_every_route_are_refused_as_ambiguous() -> None:
    chosen = _chosen_document(_entry(), _api("public"), _DOCUMENTS)

    assert isinstance(chosen, ConfigProblem)
    assert chosen.code == "nativeDocs.document.ambiguous"
    assert "'public', 'full' each hold every route" in chosen.message


def test_no_document_holding_every_route_is_refused_as_ambiguous() -> None:
    chosen = _chosen_document(_entry(), _api("public", "other"), _DOCUMENTS)

    assert isinstance(chosen, ConfigProblem)
    assert chosen.code == "nativeDocs.document.ambiguous"
    assert "none of them holds every route" in chosen.message

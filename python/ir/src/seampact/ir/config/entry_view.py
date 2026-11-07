"""Each target entry's view of the IR (ADR 0011 "The app config"), as the Node CLI builds it before a target's
generate reads it (`api-refs.ts`, `filter-operations.ts`), with the same codes: the apis `api` or `apis` names, an
api named alone being the only one of its name among the sources, then for each api its `document` (its surfaces, and
`internal: exclude` drops internal operations), then `operations.include` (empty keeps all) and `operations.exclude`,
each item an operation id or a tag. Only `operations` shrinks; the rest of the IR is a copy of the source's."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from seampact.ir.config.app_config import AppConfig, AppConfigEntry, LocalSource
from seampact.ir.config.json_value import JsonObject, bool_of, copy_of, list_of, object_of, string_of, strings_of
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.config.workspace_api_names import workspace_api_names

_SOURCE_SEPARATOR: Final = "/"


@dataclass(frozen=True, slots=True)
class SourceApi:
    """One api a source holds, as its IR JSON document: what a bundle check or the binary's compile gives. The
    document is the holder's own copy."""

    source: str
    api: str
    ir: JsonObject


@dataclass(frozen=True, slots=True)
class EntryViewResult:
    """An entry's view: each api it names with only the operations it keeps, or the problems refusing it."""

    apis: list[SourceApi]
    problems: list[ConfigProblem]


def unknown_source_problems(config: AppConfig) -> list[ConfigProblem]:
    """Each `<source>/<api>` of the Python entries whose source the app config does not define."""
    listed = ", ".join(config.sources) or "none"
    problems: list[ConfigProblem] = []

    for entry in config.entries:
        for text in entry.api_refs:
            source, api = _parsed(text)

            if source is not None and source not in config.sources:
                problems.append(
                    ConfigProblem(
                        "config.api.unknown-source",
                        f"The app config has no source '{source}' ({listed}).",
                        "Name one of the app config's `sources` before the '/', or add the source.",
                        _where(entry.id, api),
                    )
                )

    return problems


def used_sources(config: AppConfig) -> list[str]:
    """The sources the Python entries use (ADR 0011: a source no entry uses is never resolved)."""
    return sources_holding_refs(config, [ref for entry in config.entries for ref in entry.api_refs])


def sources_holding_refs(config: AppConfig, refs: Sequence[str]) -> list[str]:
    """The sources that may hold one of `refs` (each an api name alone or `<source>/<api>`), in the order the app
    config defines them: each source a `<source>/<api>` names and, for an api named alone, each source that may hold
    it: a `path` source whose workspace lists it or cannot be read (its compile then says why), and every bundle
    source, whose apis only its manifest tells."""
    named: set[str] = set()
    bare_apis: list[str] = []

    for text in refs:
        source, api = _parsed(text)

        if source is None:
            bare_apis.append(api)
        else:
            named.add(source)

    return [
        name
        for name, source in config.sources.items()
        if name in named or (bare_apis and _may_hold_any(source, bare_apis))
    ]


def _may_hold_any(source: object, apis: list[str]) -> bool:
    if not isinstance(source, LocalSource):
        return True

    names = workspace_api_names(source.directory)

    return names is None or any(api in names for api in apis)


def entry_view(entry: AppConfigEntry, apis: Sequence[SourceApi]) -> EntryViewResult:
    """`apis` are the apis of every used source."""
    resolved: dict[str, SourceApi] = {}
    problems: list[ConfigProblem] = []

    for text in entry.api_refs:
        source, api = _parsed(text)
        candidates = [
            candidate for candidate in apis if candidate.api == api and (source is None or candidate.source == source)
        ]

        if len(candidates) > 1:
            sources = ", ".join(f"'{candidate.source}'" for candidate in candidates)
            problems.append(
                ConfigProblem(
                    "config.api.ambiguous",
                    f"The api '{api}' exists in the sources {sources}.",
                    f"Name it as `<source>/{api}`.",
                    _where(entry.id, api),
                )
            )
        elif not candidates:
            problems.append(
                ConfigProblem(
                    "config.api.unknown",
                    f"No source of the app config holds an api '{text}'.",
                    "Name an api of a source's `workspace.yaml`, as `<api>` or `<source>/<api>`.",
                    _where(entry.id, api),
                )
            )
        elif candidates[0].api in resolved:
            problems.append(_duplicate_api_problem(entry, text, candidates[0].api))
        else:
            resolved[candidates[0].api] = candidates[0]

    if problems:
        return EntryViewResult([], problems)

    viewed: list[SourceApi] = []

    for api_source in resolved.values():
        filtered = _filtered(api_source.ir, entry)

        if isinstance(filtered, list):
            problems.extend(problem.with_where(_where(entry.id, api_source.api)) for problem in filtered)
        else:
            viewed.append(SourceApi(api_source.source, api_source.api, filtered))

    return EntryViewResult([], problems) if problems else EntryViewResult(viewed, [])


def _parsed(text: str) -> tuple[str | None, str]:
    """The source (None for an api named alone) and the api."""
    source, separator, api = text.partition(_SOURCE_SEPARATOR)

    return (source, api) if separator else (None, text)


def _duplicate_api_problem(entry: AppConfigEntry, text: str, api: str) -> ConfigProblem:
    """ADR 0011 places each api under `<out>/<api>`, so two items of one entry cannot share an api name."""
    listed = ", ".join(f"'{item}'" for item in entry.api_refs if _parsed(item)[1] == api)

    return ConfigProblem(
        "config.api.duplicate",
        f"The entry '{entry.id}' names the api '{api}' more than once ({listed}); '{text}' is one of them.",
        "Keep one of them, or give the sources' apis different names.",
        _where(entry.id, api),
    )


def _where(entry_id: str, api: str) -> str:
    return f"entry '{entry_id}', api '{api}'"


def _filtered(ir: JsonObject, entry: AppConfigEntry) -> JsonObject | list[ConfigProblem]:
    """A copy of `ir` with the kept operations, or the problems."""
    operations = [item for item in list_of(ir, "operations") or [] if isinstance(item, dict)]
    api = object_of(ir, "api")
    api_id = string_of(api, "id") or ""
    documents = object_of(api, "documents") or {}
    document = entry.document
    unknown = _unknown_selection_problems(api_id, documents, operations, entry)

    if unknown:
        return unknown

    in_document = [operation for operation in operations if is_in_document(documents, document, operation)]
    removed = [
        ConfigProblem(
            "filter.include.removed",
            f"The api '{api_id}' keeps no operation for the include item '{item}' once the document "
            f"'{document or '(none)'}' has run.",
            "Remove the item from `operations.include`, or choose a document that keeps it.",
        )
        for item in entry.include
        if not any(_matches(operation, item) for operation in in_document)
    ]

    if removed:
        return removed

    kept = [operation for operation in in_document if _is_kept(operation, entry)]
    copy = copy_of(ir)

    if not isinstance(copy, dict):
        raise TypeError("seampact-ir: the copy of an object is an object.")

    copy["operations"] = [copy_of(operation) for operation in kept]

    return copy


def _is_kept(operation: JsonObject, entry: AppConfigEntry) -> bool:
    included = not entry.include or any(_matches(operation, item) for item in entry.include)
    excluded = any(_matches(operation, item) for item in entry.exclude)

    return included and not excluded


def is_in_document(documents: JsonObject, document_id: str | None, operation: JsonObject) -> bool:
    """Whether the api's document `document_id` (None: the api's one document) holds `operation`."""
    if document_id is None:
        return True

    document = object_of(documents, document_id)

    if document is None:
        return False

    if string_of(document, "internal") == "exclude" and bool_of(operation, "internal") is True:
        return False

    return string_of(operation, "surface") in (strings_of(document, "surfaces") or [])


def _matches(operation: JsonObject, item: str) -> bool:
    return string_of(operation, "id") == item or item in (strings_of(operation, "tags") or [])


def _unknown_selection_problems(
    api_id: str, documents: JsonObject, operations: list[JsonObject], entry: AppConfigEntry
) -> list[ConfigProblem]:
    problems: list[ConfigProblem] = []
    document = entry.document

    if document is not None and document not in documents:
        listed = ", ".join(documents) or "none declared"
        problems.append(
            ConfigProblem(
                "filter.document.unknown",
                f"The api '{api_id}' declares no document '{document}' ({listed}).",
                "Name one of the api's `documents` in `document`, or remove `document`.",
            )
        )

    for item in [*entry.include, *entry.exclude]:
        if not any(_matches(operation, item) for operation in operations):
            problems.append(
                ConfigProblem(
                    "filter.operation.unknown",
                    f"The api '{api_id}' has no operation id or tag '{item}'.",
                    "Name an operation id or a tag of the api in `operations.include` or `operations.exclude`.",
                )
            )

    return problems

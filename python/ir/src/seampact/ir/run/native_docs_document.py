"""The seampact OpenAPI document each api of a `nativeDocs` entry follows (ADR 0011 "Which OpenAPI documents exist"),
chosen as the Node CLI chooses it: the document the entry names, else the one declared document that holds every
operation the entry generates. The pinned binary emits it with the options the app's `openapi` gives that document,
its `servers` left to the framework, in one documents run per source on a scratch app config that lists those
documents and no target entry, as a `path` source's compile does. The document is the api's whole document: the
target takes the operations it serves from it."""

import json
import os
import shutil
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from seampact.ir.binary import BinaryRefusedError, DocumentsCommand, HostPlatform, documents_with_binary
from seampact.ir.binary.failure import BinaryFailure
from seampact.ir.config.app_config import AppConfig, AppConfigEntry, LocalSource
from seampact.ir.config.entry_view import SourceApi, is_in_document
from seampact.ir.config.json_value import JsonObject, JsonValue, bool_of, copy_of, list_of, object_copy_of, object_of
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.config.yaml_reader import parse_config_text
from seampact.ir.run.contract_apis import ContractApis
from seampact.ir.run.generator import NativeDocsDocument
from seampact.ir.run.problems import problem_of_binary

NATIVE_DOCS_ARTEFACT: Final = "nativeDocs"
_SCRATCH_PREFIX: Final = "seampact-native-docs-"
_CONFIG_FILE: Final = "seampact.config.yaml"
_PATH: Final = "path"
_SERVERS: Final = "servers"


@dataclass(frozen=True, slots=True)
class NativeDocsRequest:
    """One api of a `nativeDocs` entry: the api's document `name` (None when the api declares none) and the emitter
    options the app gives it."""

    entry_id: str
    source: str
    api: str
    name: str | None
    options: JsonObject

    @property
    def key(self) -> tuple[str, str]:
        return self.entry_id, self.api


def asks_native_docs(entry: AppConfigEntry) -> bool:
    return bool_of(entry.artefacts, NATIVE_DOCS_ARTEFACT) is True


def native_docs_request(config: AppConfig, entry: AppConfigEntry, api: SourceApi) -> NativeDocsRequest | ConfigProblem:
    """`api` is the entry's view of the api: its operations are those the entry generates."""
    api_object = object_of(api.ir, "api") or {}
    documents = object_of(api_object, "documents") or {}
    name = _chosen_document(entry, api, documents)

    if isinstance(name, ConfigProblem):
        return name

    return NativeDocsRequest(entry.id, api.source, api.api, name, _emitter_options(config.openapi, api.api, name))


def native_docs_documents(
    config: AppConfig, contract_apis: ContractApis, requests: Sequence[NativeDocsRequest], environment: dict[str, str]
) -> dict[tuple[str, str], NativeDocsDocument] | list[ConfigProblem]:
    """The document of each request, by `(entry id, api)`; one binary run per source, none without a request."""
    documents: dict[tuple[str, str], NativeDocsDocument] = {}
    problems: list[ConfigProblem] = []

    for source in sorted({request.source for request in requests}):
        emitted = _emitted(
            config, contract_apis, source, [item for item in requests if item.source == source], environment
        )

        if isinstance(emitted, list):
            problems.extend(emitted)
        else:
            documents.update(emitted)

    return problems or documents


def _chosen_document(entry: AppConfigEntry, api: SourceApi, documents: JsonObject) -> str | ConfigProblem | None:
    if entry.document is not None:
        return entry.document

    declared = list(documents)

    if not declared:
        return None

    operations = [item for item in list_of(api.ir, "operations") or [] if isinstance(item, dict)]
    holding = [name for name in declared if all(is_in_document(documents, name, operation) for operation in operations)]

    if len(holding) == 1:
        return holding[0]

    why = (
        "none of them holds every route the entry generates"
        if not holding
        else f"{_quoted(holding)} each hold every route the entry generates"
    )

    return ConfigProblem(
        "nativeDocs.document.ambiguous",
        f"The api declares the documents {_quoted(declared)}; {why}, so the framework's document cannot follow one "
        "of them.",
        "Set `document` on the entry to the document the framework's document describes "
        f"({_quoted(holding or declared)}), or drop `nativeDocs`.",
        f"entry '{entry.id}', api '{api.api}'",
    )


def _quoted(names: Sequence[str]) -> str:
    return ", ".join(f"'{name}'" for name in names)


def _emitter_options(openapi: JsonValue, api: str, name: str | None) -> JsonObject:
    """The options of the app's document for the api and document name, without its `path`; `servers` stay the
    framework's own, so none is written."""
    placed = object_of(openapi, api) if isinstance(openapi, dict) else None
    placement = placed if name is None or placed is None else object_of(placed, name)
    options = {key: copy_of(value) for key, value in (placement or {}).items() if key not in (_PATH, _SERVERS)}

    return {**options, _SERVERS: []}


def _emitted(
    config: AppConfig,
    contract_apis: ContractApis,
    source: str,
    requests: list[NativeDocsRequest],
    environment: dict[str, str],
) -> dict[tuple[str, str], NativeDocsDocument] | list[ConfigProblem]:
    where = f"source '{source}' nativeDocs"
    binary = contract_apis.binary()

    if isinstance(binary, BinaryFailure):
        return [problem_of_binary(binary, where)]

    bundles, problems = contract_apis.handed_bundles()

    if problems:
        return problems

    handed = {name: directory for name, directory in bundles.items() if name == source}
    files = {(request.api, request.name): _file_name(request) for request in requests}
    scratch = tempfile.mkdtemp(prefix=_SCRATCH_PREFIX)

    try:
        config_file = os.path.join(scratch, _CONFIG_FILE)

        with open(config_file, "w", encoding="utf-8") as handle:
            handle.write(_scratch_config(config, source, requests, files))

        documents_with_binary(
            binary,
            config_file,
            DocumentsCommand.GENERATE,
            handed,
            environment,
            windows=HostPlatform.current().is_windows,
        )

        return _read_documents(scratch, requests, files, where)
    except BinaryRefusedError as refused:
        return [problem_of_binary(refused.failure, where)]
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _file_name(request: NativeDocsRequest) -> str:
    return f"{request.api}.yaml" if request.name is None else f"{request.api}.{request.name}.yaml"


def _scratch_config(
    config: AppConfig, source: str, requests: list[NativeDocsRequest], files: dict[tuple[str, str | None], str]
) -> str:
    """The binary emits the documents its config's `openapi` lists for the one source it defines. JSON is YAML."""
    defined = config.sources[source]
    source_entry: JsonObject = (
        {_PATH: defined.directory}
        if isinstance(defined, LocalSource)
        else object_copy_of(object_of(config.source_entries, source))
    )
    openapi: dict[str, JsonValue] = {}

    for request in requests:
        placement: JsonObject = {_PATH: files[(request.api, request.name)], **request.options}

        if request.name is None:
            openapi[request.api] = placement
        else:
            named = openapi.setdefault(request.api, {})

            if isinstance(named, dict):
                named[request.name] = placement

    scratch: JsonObject = {"sources": {source: source_entry}, "openapi": openapi}

    if config.allow_local is not None:
        scratch["allowLocal"] = config.allow_local

    return json.dumps(scratch)


def _read_documents(
    scratch: str, requests: list[NativeDocsRequest], files: dict[tuple[str, str | None], str], where: str
) -> dict[tuple[str, str], NativeDocsDocument] | list[ConfigProblem]:
    documents: dict[tuple[str, str], NativeDocsDocument] = {}

    for request in requests:
        file = os.path.join(scratch, files[(request.api, request.name)])

        try:
            with open(file, encoding="utf-8") as handle:
                text = handle.read()
        except OSError as failure:
            return [_unreadable(f"the binary wrote no document {file} ({failure})", where)]

        tree = parse_config_text(text, file)

        if isinstance(tree, list):
            return tree

        if not isinstance(tree.value, dict):
            return [_unreadable(f"the document {file} is not a YAML mapping", where)]

        documents[request.key] = NativeDocsDocument(request.name, tree.value)

    return documents


def _unreadable(reason: str, where: str) -> ConfigProblem:
    return ConfigProblem(
        "binary.document-unreadable",
        f"The seampact OpenAPI document `nativeDocs` follows cannot be read: {reason}.",
        "Report the binary version: its documents run wrote no readable document.",
        where,
    )

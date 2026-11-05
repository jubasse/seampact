"""`seampact generate` and `check`: reads the app config, gets the IR of each source the Python entries use, then
generates each entry with the target its `use` names and plans its write (ADR 0015 "Writing files"). The pinned binary
then writes or checks the app's OpenAPI documents. Generate writes the entries only when every entry planned and the
documents passed, so one refusal leaves every entry directory as it was; check compares the plans with the files on
disk at the `checks.generated` level and writes nothing."""

import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from importlib import metadata
from typing import Final

from seampact.ir.binary import BinaryRefusedError, DocumentsCommand, HostPlatform
from seampact.ir.binary.cache_root import locate_cache_root
from seampact.ir.bundle.fetcher import BundleFetcher
from seampact.ir.bundle.git_fetch import GitFetch
from seampact.ir.bundle.release_fetch import DEADLINE_SECONDS, ReleaseFetch
from seampact.ir.config import (
    AppConfig,
    AppConfigEntry,
    ConfigProblem,
    LocalSource,
    SourceApi,
    entry_view,
    read_app_config,
)
from seampact.ir.config.entry_view import EntryViewResult, unknown_source_problems, used_sources
from seampact.ir.config.json_value import copy_of, list_of, object_copy_of, string_of, strings_of
from seampact.ir.config.local_source_policy import LocalSourcePolicy
from seampact.ir.config.reader import CONFIG_FILE_NAME
from seampact.ir.read import IrMalformedError, IrRefusedError, read_document
from seampact.ir.run.contract_apis import ContractApis
from seampact.ir.run.discovery import InstalledTarget, discover_target, installed_versions
from seampact.ir.run.documents import documents_sources, run_documents
from seampact.ir.run.entry_plan import EntryPlan
from seampact.ir.run.framework_docs import framework_docs_problems
from seampact.ir.run.generator import (
    FrameworkDocs,
    FrameworkRoute,
    GenerationRefusedError,
    NativeDocsDocument,
    TargetEntry,
)
from seampact.ir.run.matrix_check import check_matrix
from seampact.ir.run.matrix_framework import python_targets
from seampact.ir.run.native_docs_document import (
    NativeDocsRequest,
    asks_native_docs,
    native_docs_documents,
    native_docs_request,
)
from seampact.ir.run.problems import problem_of_binary, problem_of_ir, problem_of_writer
from seampact.ir.run.report import RunReport, refused_report
from seampact.ir.write import (
    GeneratedFile,
    HandEditPolicy,
    PlannedWrite,
    WriterRefusal,
    add_header,
    commit_write,
    plan_write,
)

_ERROR: Final = "error"
_DISABLED: Final = "disabled"
_HAND_EDIT_CODES: Final = ("writer.file.edited", "writer.file.not-generated")
_GENERATE_FIX: Final = (
    "Run `seampact generate` and commit the result, or set `checks.generated` to `warning` or `disabled` in the app "
    "config."
)


@dataclass(frozen=True, slots=True)
class RunSettings:
    """What one `seampact` run reads besides the app config: the project directory (the root project's), the app
    config file, the environment of this process, and the bundle download's certificate authorities (None: the
    system's)."""

    project_directory: str
    config_file: str
    environment: Mapping[str, str]
    ca_file: str | None = None

    @staticmethod
    def default_config_file(project_directory: str) -> str:
        return os.path.join(project_directory, CONFIG_FILE_NAME)


@dataclass(frozen=True, slots=True)
class _PreparedRun:
    """A run with every entry planned, or refused one by one, before anything is written; the documents run after
    it."""

    config: AppConfig
    contract_apis: ContractApis
    plans: list[EntryPlan]
    warnings: list[ConfigProblem]


def generate(settings: RunSettings, on_hand_edit: HandEditPolicy) -> RunReport:
    prepared = _prepare(settings, on_hand_edit)

    if isinstance(prepared, list):
        return refused_report(prepared)

    problems = [problem for plan in prepared.plans for problem in plan.all_problems()]

    if problems:
        return refused_report(problems)

    command = (
        DocumentsCommand.GENERATE_OVERWRITING_HAND_EDITS
        if on_hand_edit is HandEditPolicy.OVERWRITE
        else DocumentsCommand.GENERATE
    )
    documents = run_documents(
        prepared.config, prepared.contract_apis, settings.config_file, dict(settings.environment), command
    )

    if isinstance(documents, list):
        return refused_report(documents)

    lines: list[str] = []

    for plan in prepared.plans:
        if plan.write is not None:
            written = commit_write(plan.write)
            lines.append(
                f"seampact: entry '{plan.entry_id}' wrote {len(written.written)} file(s), kept "
                f"{len(written.unchanged)}, removed {len(written.removed)} in {plan.write.root_dir}."
            )

    return RunReport(
        [*documents.lines, *lines, *_left_entries(prepared.config)],
        _printed_warnings(prepared.config, prepared.warnings),
        [],
        documents.warnings,
    )


def check(settings: RunSettings) -> RunReport:
    prepared = _prepare(settings, HandEditPolicy.REFUSE)

    if isinstance(prepared, list):
        return refused_report(prepared)

    lines = [
        f"seampact: source '{name}' passes the pinned-bundle check, integrity {integrity}."
        for name, integrity in prepared.contract_apis.checked_bundles
    ]
    level = string_of(prepared.config.checks, "generated") or _ERROR
    errors: list[ConfigProblem] = []
    warnings = list(prepared.warnings)

    for plan in prepared.plans:
        unreadable, drift = _drift(plan)
        errors.extend(unreadable)

        if drift is None or level == _DISABLED:
            continue

        if level == _ERROR:
            errors.append(drift)
        else:
            warnings.append(drift)

    printed = _printed_warnings(prepared.config, warnings)
    matched = [] if errors else ["seampact: the generated files match the files on disk."]
    documents = run_documents(
        prepared.config,
        prepared.contract_apis,
        settings.config_file,
        dict(settings.environment),
        DocumentsCommand.CHECK,
    )

    if isinstance(documents, list):
        return RunReport([*lines, *_left_entries(prepared.config)], printed, [*errors, *documents])

    return RunReport(
        [*lines, *documents.lines, *matched, *_left_entries(prepared.config)], printed, errors, documents.warnings
    )


def _prepare(settings: RunSettings, on_hand_edit: HandEditPolicy) -> _PreparedRun | list[ConfigProblem]:
    config = read_app_config(settings.config_file)

    if isinstance(config, list):
        return config

    problems = unknown_source_problems(config)
    distributions = list(metadata.distributions())
    matrix_problems, matrix_warnings = check_matrix(config, installed_versions(distributions))
    problems.extend(matrix_problems)
    targets: dict[str, InstalledTarget] = {}

    for entry in config.entries:
        target = discover_target(entry.use, entry.id, distributions)

        if isinstance(target, ConfigProblem):
            problems.append(target)
        else:
            targets[entry.id] = target
            problems.extend(framework_docs_problems(entry, target.generator))

    if problems:
        return problems

    contract_apis = _contract_apis(settings, config)

    if isinstance(contract_apis, list):
        return contract_apis

    # The binary's documents run fetches nothing: each bundle source it reads is read here, so it can be handed over.
    # A `path` source only the documents read is compiled by the binary alone, once the local policy allows it.
    used = used_sources(config)
    documents_only = [name for name in documents_sources(config) if name not in used]
    local_refusals = contract_apis.local_refusals(config, documents_only)
    document_bundles = [name for name in documents_only if not _is_local(config, name)]
    apis = contract_apis.read(config, [*used, *document_bundles])
    read_problems = [item for item in apis if isinstance(item, ConfigProblem)]

    if read_problems or local_refusals:
        return [*read_problems, *local_refusals]

    source_apis = [item for item in apis if isinstance(item, SourceApi) and item.source in used]
    views = {entry.id: entry_view(entry, source_apis) for entry in config.entries}
    native_docs = _native_docs(settings, config, contract_apis, views)

    if isinstance(native_docs, list):
        return native_docs

    plans = [_plan(entry, targets[entry.id], views[entry.id], native_docs, on_hand_edit) for entry in config.entries]
    handler_warnings = [warning for plan in plans for warning in plan.warnings]

    return _PreparedRun(config, contract_apis, plans, [*matrix_warnings, *handler_warnings])


def _native_docs(
    settings: RunSettings, config: AppConfig, contract_apis: ContractApis, views: dict[str, EntryViewResult]
) -> dict[tuple[str, str], NativeDocsDocument] | list[ConfigProblem]:
    """The seampact document of each api of a `nativeDocs` entry; an entry whose view is refused is left to its
    plan, which names why."""
    requests: list[NativeDocsRequest] = []
    problems: list[ConfigProblem] = []

    for entry in config.entries:
        if not asks_native_docs(entry):
            continue

        for api in views[entry.id].apis:
            request = native_docs_request(config, entry, api)

            if isinstance(request, ConfigProblem):
                problems.append(request)
            else:
                requests.append(request)

    if problems:
        return problems

    return native_docs_documents(config, contract_apis, requests, dict(settings.environment))


def _is_local(config: AppConfig, name: str) -> bool:
    return isinstance(config.sources[name], LocalSource)


def _contract_apis(settings: RunSettings, config: AppConfig) -> ContractApis | list[ConfigProblem]:
    try:
        cache_root = locate_cache_root(settings.environment, windows=HostPlatform.current().is_windows)
    except BinaryRefusedError as refused:
        return [problem_of_binary(refused.failure, "bundle cache")]

    fetcher = BundleFetcher(
        cache_root, ReleaseFetch(DEADLINE_SECONDS, settings.ca_file), GitFetch(settings.environment)
    )

    return ContractApis(
        fetcher,
        LocalSourcePolicy.of(config.allow_local, settings.environment),
        settings.project_directory,
        settings.environment,
    )


def _plan(
    entry: AppConfigEntry,
    target: InstalledTarget,
    view: EntryViewResult,
    native_docs: dict[tuple[str, str], NativeDocsDocument],
    on_hand_edit: HandEditPolicy,
) -> EntryPlan:
    if view.problems:
        return EntryPlan(entry.id, None, [], view.problems)

    files: list[GeneratedFile] = []
    warnings: list[ConfigProblem] = []
    problems: list[ConfigProblem] = []

    for api in view.apis:
        generated = _generated_api(entry, target, api, native_docs.get((entry.id, api.api)))

        if isinstance(generated, _GeneratedApi):
            files.extend(generated.files)
            warnings.extend(generated.warnings)
        else:
            problems.extend(generated)

    if problems:
        return EntryPlan(entry.id, None, [], problems)

    write = plan_write(entry.root, entry.id, files, on_hand_edit)

    if isinstance(write, PlannedWrite):
        return EntryPlan(entry.id, write, [], [], warnings)

    return EntryPlan(entry.id, None, write, [], warnings)


@dataclass(frozen=True, slots=True)
class _GeneratedApi:
    """One api's files, their paths below the entry root, and the forms its target leaves to the handler."""

    files: list[GeneratedFile]
    warnings: list[ConfigProblem]


def _generated_api(
    entry: AppConfigEntry, target: InstalledTarget, api: SourceApi, native_docs: NativeDocsDocument | None
) -> _GeneratedApi | list[ConfigProblem]:
    where = f"entry '{entry.id}' api '{api.api}'"
    subdirectory = api.api if entry.names_several_apis else ""
    output_directory = os.path.join(entry.root, subdirectory) if subdirectory else entry.root

    try:
        ir = read_document(copy_of(api.ir), target.generator.ir_support())
        target_entry = TargetEntry(
            entry.id,
            entry.use,
            api.api,
            entry.document,
            entry.options,
            entry.artefacts,
            output_directory,
            _framework_routes(entry),
            string_of(entry.entry, "mount"),
            python_targets().get(entry.use),
            tuple(strings_of(entry.entry, "allowUntested") or []),
            FrameworkDocs(string_of(entry.entry, "frameworkDocs") or FrameworkDocs.KEEP),
            None if native_docs is None else NativeDocsDocument(native_docs.name, object_copy_of(native_docs.document)),
        )
        files = _generated_files(target.generator.generate(ir, target_entry))
        warnings = _handler_warnings(target.generator.handler_warnings(ir, target_entry))
    except IrRefusedError as refused:
        return [problem_of_ir(refusal, entry.use, where) for refusal in refused.refusals]
    except IrMalformedError as malformed:
        return [ConfigProblem("ir.malformed", str(malformed), "Report the source of this IR: it does not read.", where)]
    except GenerationRefusedError as refused_generation:
        return refused_generation.problems
    except Exception as failure:
        return [
            ConfigProblem(
                "config.target.generate-failed",
                f"The generator of '{target.distribution}' failed: {type(failure).__name__}: {failure}",
                f"Report it to the maintainers of '{target.distribution}', or pin a release of it that generates "
                "this api.",
                where,
            )
        ]

    headed = add_header(files, target.distribution, target.version, api.api)

    if headed and isinstance(headed[0], WriterRefusal):
        return [problem_of_writer(refusal, where) for refusal in headed if isinstance(refusal, WriterRefusal)]

    placed = [
        GeneratedFile(f"{subdirectory}/{file.path}" if subdirectory else file.path, file.contents)
        for file in headed
        if isinstance(file, GeneratedFile)
    ]

    return _GeneratedApi(placed, warnings)


def _generated_files(generated: Iterable[object]) -> list[GeneratedFile]:
    """The generator's items, each a `GeneratedFile` of text paths and contents; anything else is the generator's fault
    and ends as `config.target.generate-failed`."""
    files: list[GeneratedFile] = []

    for item in generated:
        if not (isinstance(item, GeneratedFile) and isinstance(item.path, str) and isinstance(item.contents, str)):
            raise TypeError(
                f"generate() must return GeneratedFile items of text paths and contents, got {type(item).__name__}"
            )

        files.append(item)

    return files


def _handler_warnings(warnings: Iterable[object]) -> list[ConfigProblem]:
    """The generator's warnings, each a `ConfigProblem`; anything else is the generator's fault and ends as
    `config.target.generate-failed`."""
    checked: list[ConfigProblem] = []

    for item in warnings:
        if not isinstance(item, ConfigProblem):
            raise TypeError(f"handler_warnings() must return ConfigProblem items, got {type(item).__name__}")

        checked.append(item)

    return checked


def _framework_routes(entry: AppConfigEntry) -> list[FrameworkRoute]:
    return [
        FrameworkRoute(string_of(route, "path") or "", string_of(route, "reason") or "", string_of(route, "method"))
        for route in list_of(entry.entry, "frameworkRoutes") or []
        if isinstance(route, dict)
    ]


def _drift(plan: EntryPlan) -> tuple[list[ConfigProblem], ConfigProblem | None]:
    """A hand-edited or foreign file is drift the writer names; any other refusal means the check cannot compare.
    Returns the problems that keep the check from comparing, and the drift."""
    if plan.problems:
        return plan.problems, None

    where = f"entry '{plan.entry_id}'"
    other = [refusal for refusal in plan.writer_refusals if refusal.code not in _HAND_EDIT_CODES]

    if other:
        return [problem_of_writer(refusal, where) for refusal in other], None

    if plan.writer_refusals:
        items = [refusal.message.rstrip(".") for refusal in plan.writer_refusals]

        return [], _drift_problem(plan.entry_id, items, plan.writer_refusals[0].fix)

    write = plan.write

    if write is None:
        return [], None

    items = [
        f"{path} ({'differs' if os.path.exists(os.path.join(write.root_dir, path)) else 'missing'})"
        for path in write.changed()
    ]
    items += [f"{path} (stale: generated earlier, no longer produced)" for path in write.removable]

    return [], _drift_problem(plan.entry_id, items, _GENERATE_FIX) if items else None


def _drift_problem(entry_id: str, items: list[str], fix: str) -> ConfigProblem:
    return ConfigProblem(
        "check.generated.drift",
        f"The generated files of entry '{entry_id}' differ from the files on disk: {'; '.join(items)}.",
        fix,
        f"entry '{entry_id}'",
    )


def _printed_warnings(config: AppConfig, warnings: list[ConfigProblem]) -> list[ConfigProblem]:
    """The warnings `warnings.ignore` does not silence."""
    ignored = strings_of(config.warnings, "ignore") or []

    return [warning for warning in warnings if warning.code not in ignored]


def _left_entries(config: AppConfig) -> list[str]:
    return [
        f"seampact: entry '{other.id}' uses '{other.use}', which its own runner generates; seampact leaves it."
        for other in config.other_entries
    ]

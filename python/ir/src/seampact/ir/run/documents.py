"""The app's seampact OpenAPI documents (ADR 0011 "Which OpenAPI documents exist"), which the pinned binary writes and
checks: unless `openapi` is `none`, those it lists, or without the key those of the apis its target entries serve. A
run that asks for none never installs the binary."""

from dataclasses import dataclass
from typing import Final

from seampact.ir.binary import (
    BinaryRefusedError,
    DocumentsCommand,
    HostPlatform,
    documents_with_binary,
)
from seampact.ir.binary.failure import BinaryFailure
from seampact.ir.config.app_config import AppConfig, AppConfigEntry
from seampact.ir.config.entry_view import sources_holding_refs
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.run.contract_apis import ContractApis
from seampact.ir.run.problems import problem_of_binary

_NO_DOCUMENTS: Final = "none"
_WHERE: Final = "openapi"
_WARNING_PREFIX: Final = "warning: "


@dataclass(frozen=True, slots=True)
class DocumentsRun:
    """What the binary's documents run printed: its lines, and its warnings without their `warning: ` prefix."""

    lines: list[str]
    warnings: list[str]


def documents_asked(config: AppConfig) -> bool:
    if config.openapi == _NO_DOCUMENTS:
        return False

    return config.openapi is not None or bool(config.entries) or bool(config.other_entries)


def documents_sources(config: AppConfig) -> list[str]:
    """The sources the binary reads for the documents, by the rule of its own run: those holding the api of any target
    entry, this runner's or another's, or of any document `openapi` lists. None without documents."""
    if not documents_asked(config):
        return []

    listed_apis = list(config.openapi) if isinstance(config.openapi, dict) else []
    entry_refs = [ref for entry in [*config.entries, *config.other_entries] for ref in entry.api_refs]

    return sources_holding_refs(config, [*entry_refs, *listed_apis])


def run_documents(
    config: AppConfig,
    contract_apis: ContractApis,
    config_file: str,
    environment: dict[str, str],
    command: DocumentsCommand,
) -> DocumentsRun | list[ConfigProblem]:
    """Asks the binary to write or check the documents, handing over each bundle source the run checked as its checked
    cache entry; the binary fetches nothing. No documents: nothing runs."""
    if not documents_asked(config):
        return DocumentsRun([], [])

    bundle_directories, problems = contract_apis.handed_bundles()

    if problems:
        return problems

    binary = contract_apis.binary()

    if isinstance(binary, BinaryFailure):
        return [problem_of_binary(binary, _WHERE)]

    try:
        output = documents_with_binary(
            binary,
            config_file,
            command,
            bundle_directories,
            environment,
            windows=HostPlatform.current().is_windows,
        )
    except BinaryRefusedError as refused:
        return [problem_of_binary(refused.failure, _WHERE)]

    own_lines = {_left_entry_line(entry) for entry in config.entries}
    compiler_lines = [line for line in _printed_lines(output.stdout) if line not in own_lines]

    return DocumentsRun(
        [f"seampact: compiler: {line}" for line in compiler_lines],
        [line.removeprefix(_WARNING_PREFIX) for line in _printed_lines(output.stderr)],
    )


def _left_entry_line(entry: AppConfigEntry) -> str:
    """The line the binary prints for an entry it leaves to its build plugin; for this runner's own entries it is not
    shown, since this runner writes them."""
    return f"entry '{entry.id}' uses '{entry.use}', which its build plugin generates: left to it."


def _printed_lines(text: str) -> list[str]:
    return [line for line in text.split("\n") if line.strip()]

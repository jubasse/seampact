"""Gets the IR of each source the Python entries use (ADR 0010 "How a native plugin gets the IR"): a bundle source
through its channel and the pinned-bundle check, a `path` source compiled by the pinned binary, installed only when
such a source or the documents need it. Every source is tried, so one run names every problem."""

import json
import os
import shutil
import tempfile
from collections.abc import Mapping
from typing import Final

from seampact.ir.binary import (
    BinaryRefusedError,
    HostPlatform,
    InstalledBinary,
    compile_with_binary,
    install_compiler_binary,
)
from seampact.ir.binary.failure import BinaryFailure
from seampact.ir.bundle.failure import BundleFailure
from seampact.ir.bundle.fetcher import BundleFetcher
from seampact.ir.bundle.source import BundleSource
from seampact.ir.config.app_config import AppConfig, LocalSource
from seampact.ir.config.entry_view import SourceApi
from seampact.ir.config.local_source_policy import LocalSourcePolicy, refusal_reason
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.config.workspace_api_names import workspace_api_names
from seampact.ir.run.problems import problem_of_binary, problem_of_bundle

_COMPILE_ENTRY_ID: Final = "compile"
_COMPILE_PREFIX: Final = "seampact-source-"


class ContractApis:
    def __init__(
        self,
        fetcher: BundleFetcher,
        local_sources: LocalSourcePolicy,
        project_directory: str,
        environment: Mapping[str, str],
    ) -> None:
        self._fetcher = fetcher
        self._local_sources = local_sources
        self._project_directory = project_directory
        self._environment = environment
        self._binary: InstalledBinary | BinaryFailure | None = None
        # Each bundle source that passed the check, with its integrity.
        self.checked_bundles: list[tuple[str, str]] = []

    def read(self, config: AppConfig, used: list[str]) -> list[SourceApi] | list[ConfigProblem]:
        apis: list[SourceApi] = []
        problems: list[ConfigProblem] = []

        for name in used:
            source = config.sources[name]
            read = (
                self._compiled(name, source)
                if isinstance(source, LocalSource)
                else self._fetched(name, source, config.directory)
            )

            for item in read:
                if isinstance(item, SourceApi):
                    apis.append(item)
                else:
                    problems.append(item)

        return problems or apis

    def local_refusals(self, config: AppConfig, names: list[str]) -> list[ConfigProblem]:
        """The refusal of each `path` source among `names` that local sources are refused for, without compiling it:
        the sources only the binary's documents run compiles, which gets no `SEAMPACT_ALLOW_LOCAL`."""
        refusals = [
            self._local_refusal(name, config.sources[name])
            for name in names
            if isinstance(config.sources[name], LocalSource)
        ]

        return [refusal for refusal in refusals if refusal is not None]

    def handed_bundles(self) -> tuple[dict[str, str], list[ConfigProblem]]:
        """The checked cache entry of each bundle source this run read, by source name, for the binary's documents
        run; and the problems of the entries that are gone or changed since."""
        directories: dict[str, str] = {}
        problems: list[ConfigProblem] = []

        for name, integrity in self.checked_bundles:
            entry = self._fetcher.verified_cache_entry(integrity)

            if isinstance(entry, BundleFailure):
                problems.append(problem_of_bundle(entry, name))
            else:
                directories[name] = entry

        return directories, problems

    def binary(self) -> InstalledBinary | BinaryFailure:
        """The binary is installed once, on the first `path` source or the documents, and only then (ADR 0010
        "Lazy")."""
        if self._binary is None:
            try:
                self._binary = install_compiler_binary(
                    self._project_directory, HostPlatform.current(), self._environment
                )
            except BinaryRefusedError as refused:
                self._binary = refused.failure

        return self._binary

    def _fetched(self, name: str, source: BundleSource, directory: str) -> list[SourceApi | ConfigProblem]:
        fetched = self._fetcher.fetch(source, directory, self._local_sources)

        if isinstance(fetched, list):
            return [problem_of_bundle(failure, name) for failure in fetched]

        self.checked_bundles.append((name, fetched.integrity))

        return [SourceApi(name, api, document) for api, document in fetched.ir_documents.items()]

    def _local_refusal(self, name: str, source: LocalSource | BundleSource) -> ConfigProblem | None:
        if self._local_sources is not LocalSourcePolicy.REFUSE or not isinstance(source, LocalSource):
            return None

        return ConfigProblem(
            "config.source.local",
            f"The source '{name}' is a local path ({source.directory}), and local sources are refused here "
            f"({refusal_reason(self._environment)}).",
            "Use a pinned bundle source instead: `{ release: { url }, integrity }` or "
            "`{ git: { url, tag, directory }, integrity }`.",
            f"source '{name}'",
        )

    def _compiled(self, name: str, source: LocalSource) -> list[SourceApi | ConfigProblem]:
        where = f"source '{name}'"
        refused = self._local_refusal(name, source)

        if refused is not None:
            return [refused]

        binary = self.binary()

        if isinstance(binary, BinaryFailure):
            return [problem_of_binary(binary, where)]

        api_names = workspace_api_names(source.directory)
        work_directory = tempfile.mkdtemp(prefix=_COMPILE_PREFIX)

        try:
            config_file = os.path.join(work_directory, "seampact.config.yaml")

            with open(config_file, "w", encoding="utf-8") as handle:
                handle.write(_compile_config(name, source.directory))

            output = compile_with_binary(
                binary, config_file, api_names or [], self._environment, windows=HostPlatform.current().is_windows
            )
        except BinaryRefusedError as refused_error:
            return [problem_of_binary(refused_error.failure, where)]
        finally:
            shutil.rmtree(work_directory, ignore_errors=True)

        if api_names is None:
            return [
                ConfigProblem(
                    "config.source.apis-unread",
                    f"The source '{name}' compiled, but its api names cannot be read from its `workspace.yaml` or "
                    "`api.yaml`.",
                    "List the apis under `workspace.apis` in the workspace.yaml of the source.",
                    where,
                )
            ]

        apis: list[SourceApi | ConfigProblem] = []

        for api, ir_text in output.ir_text_by_api.items():
            document = json.loads(ir_text)

            if not isinstance(document, dict):
                return [
                    ConfigProblem(
                        "binary.ir-unreadable",
                        f"The IR of the api '{api}' is not a JSON object.",
                        "Report the binary version: its IR does not read.",
                        where,
                    )
                ]

            apis.append(SourceApi(name, api, document))

        return apis


def _compile_config(name: str, directory: str) -> str:
    """The binary compiles the sources its config's entries name: one source, named by one entry, and no document, so
    a run never fetches a bundle source or writes anything but the IR. JSON is YAML."""
    config = {
        "sources": {name: {"path": directory}},
        "targets": [{"id": _COMPILE_ENTRY_ID, "use": "seampact/ir", "api": f"{name}/{name}"}],
        "openapi": "none",
    }

    return json.dumps(config) + "\n"

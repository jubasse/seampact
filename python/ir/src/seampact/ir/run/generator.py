"""A Python target (ADR 0010): a class a distribution names in its `seampact.generators` entry point, built with no
argument. `seampact` reads each api an entry names with the target's `ir_support()`, then writes the files
`generate()` returns through the generated-file writer, with the header added. Generating is pure: the same IR and
entry give the same files, and a target never writes a file itself."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from seampact.ir.config.json_value import JsonValue
from seampact.ir.config.problem import ConfigProblem, problems_text
from seampact.ir.model import ContractIR
from seampact.ir.read import IrSupport
from seampact.ir.run.matrix_framework import MatrixTarget
from seampact.ir.write import GeneratedFile

ENTRY_POINT_GROUP = "seampact.generators"


@dataclass(frozen=True, slots=True)
class FrameworkRoute:
    """One item of an entry's `frameworkRoutes`: an app route the boot check lets through, its `path` a pattern where
    `*` takes one segment and `**` any number, `method` None for every method."""

    path: str
    reason: str
    method: str | None


@dataclass(frozen=True, slots=True)
class TargetEntry:
    """One api of a target entry, as a generator receives it: the entry's `id` and `use`, the api, the entry's
    `options` and `artefacts` (copies), the absolute `output_directory` the files go to (`<outDir>/<out>`, plus
    `/<api>` for an entry with `apis`), the entry's `framework_routes` and `mount`, which the target's boot check
    reads, the target's row of the compatibility matrix (None for a target the matrix does not record) and the
    entry's `allow_untested` items, from which the generated code records the framework versions `generate`
    accepted."""

    id: str
    use: str
    api: str
    document: str | None
    options: Mapping[str, JsonValue]
    artefacts: Mapping[str, JsonValue]
    output_directory: str
    framework_routes: Sequence[FrameworkRoute]
    mount: str | None
    matrix: MatrixTarget | None
    allow_untested: Sequence[str]


@runtime_checkable
class Generator(Protocol):
    def ir_support(self) -> IrSupport:
        """The IR versions, revision, declaration kinds and must-understand features this target reads."""
        ...

    def framework_docs_off_fix(self) -> str | None:
        """The fix `seampact` states when an entry sets `frameworkDocs: off` on a target that cannot switch its
        framework's own OpenAPI document off; None for a target that writes that switch."""
        ...

    def generate(self, ir: ContractIR, entry: TargetEntry) -> Sequence[GeneratedFile]:
        """The files of one api of `entry`, each path relative to `entry.output_directory`. Raises
        `GenerationRefusedError` for a contract or option the target refuses, by name."""
        ...


class GenerationRefusedError(Exception):
    """A generator refuses what it reads (a contract form, an option), each refusal named with its code and fix."""

    def __init__(self, problems: Sequence[ConfigProblem]) -> None:
        super().__init__(problems_text(problems))
        self.problems = list(problems)

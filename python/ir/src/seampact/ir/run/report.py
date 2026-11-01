"""What one `seampact` run did: the lines it prints, the warnings, and the problems that fail it; no problem passes."""

from dataclasses import dataclass, field

from seampact.ir.config.problem import ConfigProblem


@dataclass(frozen=True, slots=True)
class RunReport:
    """`compiler_warnings` are the compiler binary's warnings on the documents, as it printed them."""

    lines: list[str]
    warnings: list[ConfigProblem]
    problems: list[ConfigProblem]
    compiler_warnings: list[str] = field(default_factory=list)


def refused_report(problems: list[ConfigProblem]) -> RunReport:
    return RunReport([], [], problems)

"""Why an app config, or a run built on it, is refused: the same `code` as the Node CLI gives for the same case, a
`message`, its `fix`, and `where` it is (`<file> <key path>`, `entry '<id>'`, `source '<name>'`...)."""

from collections.abc import Sequence
from dataclasses import dataclass, replace


@dataclass(frozen=True, slots=True)
class ConfigProblem:
    code: str
    message: str
    fix: str
    where: str | None = None

    def with_where(self, where: str) -> "ConfigProblem":
        return replace(self, where=where)


def problems_text(problems: Sequence[ConfigProblem]) -> str:
    """One block per problem: its code and place, its message and fix."""
    blocks = [
        f"{problem.code}{'' if problem.where is None else f' ({problem.where})'}: {problem.message}\n"
        f"    Fix: {problem.fix}"
        for problem in problems
    ]

    return "\n".join(blocks)

"""One entry's plan: the writer's plan of its files, or why it does not generate. `writer_refusals` are the writer's
own (a check reads hand edits among them as drift); `problems` are every other refusal; `warnings` are the forms its
target leaves to the handler, which generate and check print."""

from dataclasses import dataclass, field

from seampact.ir.config.problem import ConfigProblem
from seampact.ir.run.problems import problem_of_writer
from seampact.ir.write import PlannedWrite, WriterRefusal


@dataclass(frozen=True, slots=True)
class EntryPlan:
    entry_id: str
    write: PlannedWrite | None
    writer_refusals: list[WriterRefusal]
    problems: list[ConfigProblem]
    warnings: list[ConfigProblem] = field(default_factory=list)

    def all_problems(self) -> list[ConfigProblem]:
        where = f"entry '{self.entry_id}'"

        return [*self.problems, *(problem_of_writer(refusal, where) for refusal in self.writer_refusals)]

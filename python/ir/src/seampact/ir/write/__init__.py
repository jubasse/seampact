"""The generated-file writer (ADR 0015 "Writing files" and "The generated header"): plans and commits the files of
one target entry in its output directory."""

from seampact.ir.write.generated_file import GeneratedFile
from seampact.ir.write.header import add_header
from seampact.ir.write.policy import HandEditPolicy
from seampact.ir.write.refusal import WriterRefusal
from seampact.ir.write.writer import PlannedWrite, WrittenFiles, commit_write, plan_write

__all__ = [
    "GeneratedFile",
    "HandEditPolicy",
    "PlannedWrite",
    "WriterRefusal",
    "WrittenFiles",
    "add_header",
    "commit_write",
    "plan_write",
]

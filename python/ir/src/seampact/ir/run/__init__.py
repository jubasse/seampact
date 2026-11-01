"""The `seampact` runner of a Python build: `generate` and `check` an app config with the targets installed as
`seampact.generators` entry points, and the documents through the compiler binary."""

from seampact.ir.run.generator import FrameworkRoute, GenerationRefusedError, Generator, TargetEntry
from seampact.ir.run.report import RunReport
from seampact.ir.run.runner import RunSettings, check, generate

__all__ = [
    "FrameworkRoute",
    "GenerationRefusedError",
    "Generator",
    "RunReport",
    "RunSettings",
    "TargetEntry",
    "check",
    "generate",
]

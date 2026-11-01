"""What the writer does with a generated file edited by hand since it was written: refuse, or write over it
(`--force`)."""

from enum import Enum


class HandEditPolicy(Enum):
    REFUSE = "refuse"
    OVERWRITE = "overwrite"

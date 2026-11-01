"""`Field`: a value that may be absent, told apart from an explicit null (`None`) by the `Absent` sentinel."""

from enum import Enum
from typing import Literal


class Absent(Enum):
    """The one value of an absent field."""

    ABSENT = "absent"


type Field[T] = T | Literal[Absent.ABSENT]

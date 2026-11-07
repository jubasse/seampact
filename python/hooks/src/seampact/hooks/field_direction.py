"""Whether a field right is checked on the way in or on the way out."""

from enum import StrEnum


class FieldDirection(StrEnum):
    INPUT = "input"
    OUTPUT = "output"

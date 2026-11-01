"""Whether a requirement is a right or a rule."""

from enum import StrEnum


class RequirementKind(StrEnum):
    RIGHT = "right"
    RULE = "rule"

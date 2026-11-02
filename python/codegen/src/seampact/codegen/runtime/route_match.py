"""The contract's operations as the boundary matches them against the raw path: each route's method and template
split into segments, literal segments compared undecoded, and the most specific template tried first."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cmp_to_key
from typing import Final
from urllib.parse import unquote_to_bytes

_PARAMETER: Final = re.compile(r"\{([^{}]+)\}")
_DOT_SEGMENTS: Final = frozenset({b".", b".."})


@dataclass(frozen=True, slots=True)
class TemplateSegment:
    literal: bool
    text: str


@dataclass(frozen=True, slots=True)
class ContractRoute:
    operation_id: str
    method: str
    segments: tuple[TemplateSegment, ...]
    base_path: str

    @classmethod
    def of(cls, operation_id: str, method: str, template: str, base_path: str) -> "ContractRoute":
        """`template` is the mounted contract path, such as `/v1/tasks/{taskId}`."""
        segments = []

        for segment in template.split("/")[1:]:
            parameter = _PARAMETER.fullmatch(segment)
            segments.append(TemplateSegment(False, parameter.group(1)) if parameter else TemplateSegment(True, segment))

        return cls(operation_id, method.upper(), tuple(segments), base_path)

    def match(self, raw_segments: Sequence[str]) -> dict[str, str] | None:
        """The raw path parameters when the segments match: a literal segment matches its text exactly, undecoded;
        a parameter matches a segment that is not empty, holds no `;`, raw or percent-encoded (ADR 0026 "Routes"),
        and is no dot segment once decoded."""
        if len(raw_segments) != len(self.segments):
            return None

        parameters: dict[str, str] = {}

        for segment, raw in zip(self.segments, raw_segments, strict=True):
            if segment.literal:
                if raw != segment.text:
                    return None
                continue

            decoded = unquote_to_bytes(raw)

            if raw == "" or b";" in decoded or decoded in _DOT_SEGMENTS:
                return None

            parameters[segment.text] = raw

        return parameters


@dataclass(frozen=True, slots=True)
class RouteMatch:
    """The operation a raw path matched with its raw parameters; `operation_id` None for a path under one of the
    api's base paths that no contract route serves with this method (the api's `notFound`)."""

    operation_id: str | None
    raw_parameters: dict[str, str]


def most_specific_first(routes: Sequence[ContractRoute]) -> list[ContractRoute]:
    """Literal segments sort before parameters at the first segment where two templates differ."""
    return sorted(routes, key=cmp_to_key(_compare_specificity))


def _compare_specificity(first: ContractRoute, second: ContractRoute) -> int:
    for index, segment in enumerate(first.segments):
        if index >= len(second.segments):
            return 1

        other = second.segments[index]

        if segment.literal != other.literal:
            return -1 if segment.literal else 1

    return len(first.segments) - len(second.segments)

"""The entry's `frameworkRoutes` allow-list as the Python boot checks read it (FR-25): an app route at or under one of
the api's base paths is refused unless an item lists it, by a path pattern where `*` takes one segment and `**` any
number (none included), and a method or every method. Empty segments are dropped on both sides, and a catch-all
route segment (`{*name}`, `{name:path}`) is taken only by `**`, as every server target reads the rule."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cache
from typing import Final

_ANY_NUMBER: Final = "**"
_CATCH_ALL_ROUTE_SEGMENT: Final = re.compile(r"\{\*[^}]*\}|\{[^}]*:path\}")


@dataclass(frozen=True, slots=True, kw_only=True)
class FrameworkRouteRule:
    """An item of the entry's `frameworkRoutes`: `path` a pattern where `*` takes one segment and `**` any number,
    `method` None for every method."""

    path: str
    method: str | None
    reason: str


def allow_listed(rules: Sequence[FrameworkRouteRule], path: str, method: str) -> bool:
    route = _segments(path)

    return any(rule.method in (None, method) and _takes(_segments(rule.path), route) for rule in rules)


def base_path_of(path: str, base_paths: Sequence[str]) -> str | None:
    """The first base path `path` sits at or under, None when it sits under none."""
    return next((base for base in base_paths if _under(path, base)), None)


def _segments(path: str) -> tuple[str, ...]:
    return tuple(segment for segment in path.split("/") if segment)


def _takes(pattern: tuple[str, ...], route: tuple[str, ...]) -> bool:
    if not pattern:
        return not route

    head = pattern[0]

    if head == _ANY_NUMBER:
        return _takes(pattern[1:], route) or (bool(route) and _takes(pattern, route[1:]))

    if not route or _CATCH_ALL_ROUTE_SEGMENT.fullmatch(route[0]):
        return False

    return _segment_rule(head).fullmatch(route[0]) is not None and _takes(pattern[1:], route[1:])


@cache
def _segment_rule(segment: str) -> re.Pattern[str]:
    return re.compile("[^/]*".join(re.escape(part) for part in segment.split("*")))


def _under(path: str, base: str) -> bool:
    return base == "" or path == base or path.startswith(base + "/") or path.startswith(base + "{")

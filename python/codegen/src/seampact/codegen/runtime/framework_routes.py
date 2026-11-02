"""The entry's `frameworkRoutes` allow-list as the Python boot checks read it (FR-25): an app route at or under one of
the api's base paths is refused unless an item lists it, by a path pattern where `*` takes one segment and `**` any
number, and a method or every method."""

import re
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True, kw_only=True)
class FrameworkRouteRule:
    """An item of the entry's `frameworkRoutes`: `path` a pattern where `*` takes one segment and `**` any number,
    `method` None for every method."""

    path: str
    method: str | None
    reason: str


def allow_listed(rules: Sequence[FrameworkRouteRule], path: str, method: str) -> bool:
    return any(_path_rule(rule.path).fullmatch(path) and rule.method in (None, method) for rule in rules)


def base_path_of(path: str, base_paths: Sequence[str]) -> str | None:
    """The first base path `path` sits at or under, None when it sits under none."""
    return next((base for base in base_paths if _under(path, base)), None)


def _path_rule(pattern: str) -> re.Pattern[str]:
    parts = [re.escape(part).replace(r"\*", "[^/]*") for part in pattern.split("**")]

    return re.compile(".*".join(parts))


def _under(path: str, base: str) -> bool:
    return base == "" or path == base or path.startswith(base + "/") or path.startswith(base + "{")

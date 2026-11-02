"""The framework-free pattern check against ADR 0003 section 9's normalised meanings and the reference contract's
patterns: every pattern of the reference golden IRs compiles for Python's `re` and gives the contract's verdicts."""

import json
from pathlib import Path

import pytest

from seampact.codegen.runtime.pattern import contract_pattern, python_regex

_DOT = "[^\\u000A\\u000D\\u0085\\u2028-\\u2029]"


@pytest.mark.parametrize(
    ("normalized", "text", "matches"),
    [
        (f"^a{_DOT}b$", "axb", True),
        (f"^a{_DOT}b$", "a\u0085b", False),
        (f"^a{_DOT}b$", "a\u2028b", False),
        (f"^a{_DOT}b$", "a\U0001f600b", True),
        ("^[\\u0009-\\u000D ]$", "\u000b", True),
        ("^[\\u0009-\\u000D ]$", "\u00a0", False),
        ("^ab$", "ab", True),
        ("^ab$", "ab\n", False),
        ("^[\\-0-9_]$", "-", True),
        ("\\{\\}\\]", "x{}]", True),
        ("^[\\u0000-/:-\\u{10FFFF}]$", "\U0001f600", True),
        ("^[\\u0000-/:-\\u{10FFFF}]$", "5", False),
        ("b", "abc", True),
        ("^[\\^$]$", "$", True),
    ],
)
def test_normalised_meanings(normalized: str, text: str, matches: bool) -> None:
    assert contract_pattern(normalized).matches(text) is matches


def test_anchors_and_astral_escapes_translate_for_re() -> None:
    assert python_regex("^a[$^]\\$\\u{1F600}$") == "\\Aa[$^]\\$\\U0001F600\\Z"


def _patterns(node: object) -> list[str]:
    if isinstance(node, dict):
        pattern = node.get("pattern")
        own = [pattern["normalized"]] if isinstance(pattern, dict) else []
        return own + [found for value in node.values() for found in _patterns(value)]

    if isinstance(node, list):
        return [found for item in node for found in _patterns(item)]

    return []


def test_the_reference_patterns_compile_and_keep_their_verdicts(repository_root: Path) -> None:
    patterns = sorted(
        {
            normalized
            for path in (repository_root / "fixtures/golden/reference").glob("*.ir.json")
            for normalized in _patterns(json.loads(path.read_text(encoding="utf-8")))
        }
    )

    assert patterns == ["^(?:createdAt|-createdAt)$"]

    sort = contract_pattern(patterns[0])

    assert sort.matches("createdAt")
    assert sort.matches("-createdAt")
    assert not sort.matches("createdAt\n")
    assert not sort.matches("+createdAt")

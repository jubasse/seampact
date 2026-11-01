"""Every golden IR reads with no `Unknown` and writes back equal; every golden side table round-trips.

The files are found by walking `fixtures/golden`, so a case another lane adds is read without a change here.
"""

import dataclasses
import json
from collections.abc import Mapping
from pathlib import Path

from seampact.ir.hydration import UnknownEnumValue, UnknownVariant
from seampact.ir.model import SourceMap
from seampact.ir.read import IrSupport, read_ir

_HTTP_OPERATION = "httpOperation"


def _golden_files(repository_root: Path, suffix: str) -> list[Path]:
    return sorted((repository_root / "fixtures/golden").rglob(f"*{suffix}"))


def _unknowns(value: object, at: str) -> list[str]:
    """The paths of every `Unknown` value the model kept."""
    if isinstance(value, UnknownEnumValue | UnknownVariant):
        return [at]

    if isinstance(value, tuple):
        return [found for index, item in enumerate(value) for found in _unknowns(item, f"{at}/{index}")]

    if isinstance(value, Mapping):
        return [found for key, item in value.items() for found in _unknowns(item, f"{at}/{key}")]

    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return [
            found
            for field in dataclasses.fields(value)
            for found in _unknowns(getattr(value, field.name), f"{at}/{field.name}")
        ]

    return []


def test_finds_golden_files(repository_root: Path) -> None:
    assert _golden_files(repository_root, ".ir.json")
    assert _golden_files(repository_root, ".source-map.json")


def test_golden_irs_read_with_no_unknown_and_write_back_equal(repository_root: Path) -> None:
    support = IrSupport.of_model(kinds=[_HTTP_OPERATION])

    for path in _golden_files(repository_root, ".ir.json"):
        text = path.read_text(encoding="utf-8")
        contract = read_ir(text, support)

        assert _unknowns(contract, "") == [], path
        assert contract.to_json() == json.loads(text), path


def test_golden_side_tables_write_back_equal(repository_root: Path) -> None:
    for path in _golden_files(repository_root, ".source-map.json"):
        document = json.loads(path.read_text(encoding="utf-8"))

        assert SourceMap.from_json(document).to_json() == document, path

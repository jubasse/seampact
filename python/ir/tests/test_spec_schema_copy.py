"""The schemas `seampact-ir` ships in `seampact/ir/schemas/` are byte-equal to those of `@seampact/spec`."""

from pathlib import Path

import pytest

import seampact.ir

_SPEC_SCHEMAS = "packages/core/spec/schemas"
# The spec schema directories this package ships copies of, every schema of each.
_SCHEMA_DIRECTORIES = ("bundle", "config", "ir")


def _copies() -> Path:
    return Path(seampact.ir.__file__).parent / "schemas"


def _spec_schemas(repository_root: Path) -> list[str]:
    root = repository_root / _SPEC_SCHEMAS

    return [
        f"{directory}/{file.name}"
        for directory in _SCHEMA_DIRECTORIES
        for file in sorted((root / directory).glob("*.schema.json"))
    ]


def test_ships_an_exact_copy_of_every_spec_schema(repository_root: Path) -> None:
    schemas = _spec_schemas(repository_root)
    assert schemas

    for relative_path in schemas:
        spec = (repository_root / _SPEC_SCHEMAS / relative_path).read_bytes()
        copy = _copies() / relative_path

        assert copy.is_file(), f"Copy packages/core/spec/schemas/{relative_path} to python/ir/src/seampact/ir/schemas/."
        assert copy.read_bytes() == spec, f"Copy packages/core/spec/schemas/{relative_path} again."


def test_ships_no_schema_the_spec_dropped(repository_root: Path) -> None:
    shipped = [
        f"{directory}/{file.name}"
        for directory in _SCHEMA_DIRECTORIES
        for file in sorted((_copies() / directory).glob("*.json"))
    ]

    assert shipped == _spec_schemas(repository_root)


@pytest.mark.parametrize("directory", _SCHEMA_DIRECTORIES)
def test_the_schema_directories_are_not_empty(directory: str) -> None:
    assert any((_copies() / directory).glob("*.schema.json"))

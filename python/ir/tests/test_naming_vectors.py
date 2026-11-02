"""The shared naming vectors (ADR 0007 section 6) against the Python naming: segments, operation ids and the
`python` identifier of each vector; and the reserved words this package ships are `@seampact/spec`'s."""

import json
from pathlib import Path
from typing import Any

import pytest

import seampact.ir.naming
from seampact.ir.naming import (
    IrName,
    NameSource,
    NamingRole,
    OperationIdCase,
    operation_id,
    python_identifier,
    segments_of,
)

_NO_SEGMENT = "no-segment"
_MIN_VECTORS = 100


def _vectors(repository_root: Path) -> list[dict[str, Any]]:
    path = repository_root / "packages/core/spec/vectors/naming/vectors.json"
    vectors: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))

    return vectors


def _segments_of_vector(vector: dict[str, Any]) -> list[str] | None:
    if "owner" in vector:
        owner: list[str] = vector["owner"]
        return owner

    return segments_of(vector["written"], NameSource(vector["source"]), vector.get("codeName"), vector.get("position"))


def test_vectors(repository_root: Path) -> None:
    vectors = _vectors(repository_root)
    assert len(vectors) > _MIN_VECTORS

    for vector in vectors:
        identifier = vector["id"]
        segments = _segments_of_vector(vector)

        if "error" in vector:
            assert vector["error"] == _NO_SEGMENT, identifier
            assert segments is None, identifier
            continue

        assert segments is not None, identifier
        assert segments == vector["segments"], identifier
        name = IrName(tuple(segments), NamingRole(vector["role"]), vector.get("status"))
        assert python_identifier(name) == vector["expected"]["python"], identifier

        if "operationId" in vector:
            assert operation_id(segments, OperationIdCase.CAMEL) == vector["operationId"]["camel"], identifier
            assert operation_id(segments, OperationIdCase.SNAKE) == vector["operationId"]["snake"], identifier


def test_the_vectors_cover_the_roles_and_the_sources(repository_root: Path) -> None:
    vectors = _vectors(repository_root)

    assert {vector["role"] for vector in vectors} == {role.value for role in NamingRole}
    assert {vector.get("source", "") for vector in vectors} == {"", *(source.value for source in NameSource)}


def test_words_append_the_role_suffix_and_the_status() -> None:
    assert IrName(("tasks",), NamingRole.RESPONSE, 201).words() == ("tasks", "response", "201")
    assert IrName(("tasks",), NamingRole.SCHEMA).words() == ("tasks",)


@pytest.mark.parametrize("position", [None, 0])
def test_an_enum_value_needs_a_positive_position(position: int | None) -> None:
    with pytest.raises(ValueError, match="one-based position"):
        segments_of("done", NameSource.ENUM_VALUE, None, position)


@pytest.mark.parametrize(
    ("segments", "role", "status"),
    [
        (("Upper",), NamingRole.SCHEMA, None),
        (("tasks",), NamingRole.RESPONSE, None),
        (("tasks",), NamingRole.RESPONSE, 404),
        (("tasks",), NamingRole.INPUT, 200),
    ],
)
def test_a_malformed_name_is_refused(segments: tuple[str, ...], role: NamingRole, status: int | None) -> None:
    with pytest.raises(ValueError):
        IrName(segments, role, status)


@pytest.mark.parametrize(
    ("segments", "case"),
    [([], OperationIdCase.CAMEL), (["Get"], OperationIdCase.CAMEL), (["list", "my-tasks"], OperationIdCase.SNAKE)],
)
def test_a_malformed_operation_id_is_refused(segments: list[str], case: OperationIdCase) -> None:
    with pytest.raises(ValueError):
        operation_id(segments, case)


def test_ships_the_spec_reserved_words(repository_root: Path) -> None:
    spec = repository_root / "packages/core/spec/vectors/naming/reserved-words.json"
    copy = Path(seampact.ir.naming.__file__).parent / "reserved-words.json"

    assert copy.read_bytes() == spec.read_bytes(), (
        "Copy packages/core/spec/vectors/naming/reserved-words.json to python/ir/src/seampact/ir/naming/ again."
    )


def test_a_member_and_a_type_escape_a_leading_digit_differently() -> None:
    assert python_identifier(IrName(("2fa",), NamingRole.MEMBER)) == "field_2fa"
    assert python_identifier(IrName(("2fa",), NamingRole.SCHEMA)) == "_2fa"

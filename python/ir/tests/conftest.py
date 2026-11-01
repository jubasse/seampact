"""Fixtures shared by the tests of `seampact-ir`: the repository the shared vectors and golden files live in."""

from pathlib import Path

import pytest

# python/ir/tests/conftest.py: the repository root is three directories up from this one.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def repository_root() -> Path:
    return _REPOSITORY_ROOT

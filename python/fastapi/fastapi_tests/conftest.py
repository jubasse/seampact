"""Fixtures shared by the tests of `seampact-fastapi`: the repository the golden IRs live in."""

from pathlib import Path

import pytest

# python/fastapi/fastapi_tests/conftest.py: the repository root is three directories up from this one.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def repository_root() -> Path:
    return _REPOSITORY_ROOT

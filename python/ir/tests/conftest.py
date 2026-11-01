"""Fixtures shared by the tests of `seampact-ir`: the repository the shared vectors and golden files live in."""

import os
from collections.abc import Callable
from pathlib import Path

import pytest

from seampact.ir.binary.posix_cache_safety import PathFact, PathFacts, PosixCacheSafety, PosixPathFacts

# python/ir/tests/conftest.py: the repository root is three directories up from this one.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def repository_root() -> Path:
    return _REPOSITORY_ROOT


_ROOT_UID = 0
_WORLD_READABLE_DIRECTORY = 0o755


class _TrustedAncestorFacts:
    """The real facts below the cache root; above it a root-owned `0755` directory, since a test's temporary
    directory sits under the world-writable `/tmp`."""

    def __init__(self, cache_root: Path) -> None:
        self._cache_root = os.path.realpath(cache_root)
        self._real: PathFacts = PosixPathFacts()

    def of(self, path: str) -> PathFact | None:
        if path == self._cache_root or path.startswith(self._cache_root + os.sep):
            return self._real.of(path)

        return PathFact(False, _ROOT_UID, self.current_gid(), _WORLD_READABLE_DIRECTORY)

    def current_uid(self) -> int:
        return self._real.current_uid()

    def current_gid(self) -> int:
        return self._real.current_gid()


@pytest.fixture
def trusting_ancestors() -> Callable[[Path], PosixCacheSafety]:
    """The POSIX cache rule of a test's cache root: its own facts below the root, trusted ones above it."""
    return lambda cache_root: PosixCacheSafety(_TrustedAncestorFacts(cache_root))

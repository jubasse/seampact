"""Fixtures shared by the tests of `seampact-ir`: the repository the shared vectors and golden files live in."""

import base64
import io
import json
import os
import subprocess
import tarfile
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


_MANIFEST_FILE = "seampact-bundle.json"


@pytest.fixture(scope="session")
def valid_bundle(repository_root: Path) -> tuple[dict[str, bytes], str]:
    """The files of the shared `valid` bundle vector and its integrity pin."""
    document = json.loads((repository_root / "packages/core/spec/vectors/bundle/vectors.json").read_text("utf-8"))
    vector = next(item for item in document["directories"] if item["id"] == "valid")
    files = {file["path"]: base64.b64decode(file["base64"]) for file in vector["files"]}

    return files, str(vector["pin"])


@pytest.fixture(scope="session")
def valid_bundle_tarball(valid_bundle: tuple[dict[str, bytes], str]) -> bytes:
    """The valid bundle as a gzip ustar archive, the manifest first."""
    files, _ = valid_bundle
    buffer = io.BytesIO()

    with tarfile.open(fileobj=buffer, mode="w:gz", format=tarfile.USTAR_FORMAT) as archive:
        for path in sorted(files, key=lambda name: name != _MANIFEST_FILE):
            member = tarfile.TarInfo(path)
            member.size = len(files[path])
            archive.addfile(member, io.BytesIO(files[path]))

    return buffer.getvalue()


type GitRepositoryFactory = Callable[..., tuple[Path, dict[str, str]]]


def _git_environment(home: Path) -> dict[str, str]:
    return {
        "PATH": os.environ["PATH"],
        "HOME": str(home),
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
    }


def _make_git_repository(
    root: Path, files: dict[str, bytes], tag: str = "v1", links: dict[str, str] | None = None
) -> tuple[Path, dict[str, str]]:
    """A repository under `root` holding `files` below `contract/`, committed and tagged; with the environment git
    runs in."""
    environment = _git_environment(root)
    repository = root / "repository"
    repository.mkdir()

    def git(*arguments: str) -> None:
        subprocess.run(["git", "-C", str(repository), *arguments], check=True, capture_output=True, env=environment)

    git("init", "--quiet", "-b", "main")

    for path, data in files.items():
        target = repository / "contract" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    for path, destination in (links or {}).items():
        os.symlink(destination, repository / "contract" / path)

    git("add", "-A")
    git("commit", "--quiet", "-m", "bundle")
    git("tag", tag)

    return repository, environment


@pytest.fixture
def git_repository() -> GitRepositoryFactory:
    return _make_git_repository

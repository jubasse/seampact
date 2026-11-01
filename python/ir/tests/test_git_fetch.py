"""The git channel against a local repository: the tag's tree is read through git objects, never a work tree."""

from collections.abc import Callable
from pathlib import Path

import pytest

from seampact.ir.bundle import BundleChannel, BundleFailure, BundleFailureCode, BundleFiles, verify_bundle
from seampact.ir.bundle.git_fetch import GitFetch
from seampact.ir.bundle.layout import EXTRACTED_BYTES_MAX
from seampact.ir.bundle.source import GitSource
from seampact.ir.config.local_source_policy import LocalSourcePolicy

type GitRepositoryFactory = Callable[..., tuple[Path, dict[str, str]]]


def _source(repository: Path, **members: str) -> GitSource:
    return GitSource(
        url=members.get("url", str(repository)),
        tag=members.get("tag", "v1"),
        directory=members.get("directory", "contract"),
        integrity=None,
    )


def test_the_tag_tree_is_read_and_passes_the_pinned_bundle_check(
    tmp_path: Path, git_repository: GitRepositoryFactory, valid_bundle: tuple[dict[str, bytes], str]
) -> None:
    files, pin = valid_bundle
    repository, environment = git_repository(tmp_path, files)

    fetched = GitFetch(environment).fetch(_source(repository), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(fetched, BundleFiles)
    assert {path: fetched.read(path) for path in fetched.sizes} == files
    assert verify_bundle(fetched, pin, BundleChannel.GIT).ok


def test_a_local_repository_is_refused_when_local_sources_are_refused(
    tmp_path: Path, git_repository: GitRepositoryFactory
) -> None:
    repository, environment = git_repository(tmp_path, {"a": b"x"})

    result = GitFetch(environment).fetch(_source(repository), str(tmp_path), LocalSourcePolicy.REFUSE)

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.SOURCE_LOCAL


def test_a_relative_local_path_is_read_from_the_base_directory(
    tmp_path: Path, valid_bundle: tuple[dict[str, bytes], str], git_repository: GitRepositoryFactory
) -> None:
    repository, environment = git_repository(tmp_path, valid_bundle[0])

    result = GitFetch(environment).fetch(_source(repository, url="repository"), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(result, BundleFiles)


@pytest.mark.parametrize(
    ("members", "code"),
    [
        ({"tag": "nothing"}, BundleFailureCode.GIT_FAILED),
        ({"tag": "-x"}, BundleFailureCode.GIT_TAG),
        ({"tag": "a..b"}, BundleFailureCode.GIT_TAG),
        ({"directory": "../up"}, BundleFailureCode.GIT_DIRECTORY),
        ({"url": "ext::sh -c id"}, BundleFailureCode.GIT_FAILED),
        ({"url": "ftp://example.com/r.git"}, BundleFailureCode.GIT_URL),
    ],
)
def test_a_source_that_cannot_be_fetched_is_refused_by_name(
    tmp_path: Path, members: dict[str, str], code: BundleFailureCode, git_repository: GitRepositoryFactory
) -> None:
    repository, environment = git_repository(tmp_path, {"a": b"x"})

    result = GitFetch(environment).fetch(_source(repository, **members), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(result, BundleFailure)
    assert result.code is code


def test_a_link_in_the_tree_is_refused(tmp_path: Path, git_repository: GitRepositoryFactory) -> None:
    repository, environment = git_repository(tmp_path, {"seampact-bundle.json": b"{}"}, links={"sources": "/etc"})

    result = GitFetch(environment).fetch(_source(repository), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.ARCHIVE_ENTRY_TYPE


def test_a_path_outside_the_bundle_layout_is_refused(tmp_path: Path, git_repository: GitRepositoryFactory) -> None:
    repository, environment = git_repository(tmp_path, {"seampact-bundle.json": b"{}", "notes.txt": b"x"})

    result = GitFetch(environment).fetch(_source(repository), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.ARCHIVE_ENTRY_PATH


def test_the_user_repository_in_git_dir_is_never_touched(
    tmp_path: Path, valid_bundle: tuple[dict[str, bytes], str], git_repository: GitRepositoryFactory
) -> None:
    repository, environment = git_repository(tmp_path, valid_bundle[0])
    hostile = {**environment, "GIT_DIR": str(tmp_path / "elsewhere")}

    result = GitFetch(hostile).fetch(_source(repository), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(result, BundleFiles)
    assert not (tmp_path / "elsewhere").exists()


def test_a_blob_past_the_size_cap_is_refused_before_it_is_read(
    tmp_path: Path, git_repository: GitRepositoryFactory
) -> None:
    oversized = b"\0" * (EXTRACTED_BYTES_MAX + 1)
    repository, environment = git_repository(tmp_path, {"seampact-bundle.json": b"{}", "sources/big.bin": oversized})

    result = GitFetch(environment).fetch(_source(repository), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.ARCHIVE_EXTRACTED_TOO_LARGE

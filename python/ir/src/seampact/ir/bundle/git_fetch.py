"""The git-tag channel, as `fetch-git.ts`: a shallow fetch of the tag with the system `git` into a new bare
repository, then the files of the tag's tree read with `git ls-tree` and `git cat-file`, never through a work tree, so
`autocrlf`, attributes, smudge filters and LFS cannot change a byte. Only `https:` and `ssh` repositories are fetched,
plus local ones (`file:` or a path) when local sources are allowed; `ext::` is off. The tree is untrusted: a link, a
submodule, an unportable path or a case-fold duplicate is refused before anything is read. Every command names the
temporary repository by `--git-dir` and drops the variables that locate a repository, so a run from a git hook (which
exports `GIT_DIR`) never touches the user's repository. The files stay in memory."""

import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Mapping
from typing import Final

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.files import BundleFiles
from seampact.ir.bundle.layout import ENTRIES_MAX, EXTRACTED_BYTES_MAX, MANIFEST_FILE, NOT_A_BUNDLE_FIX
from seampact.ir.bundle.path import fold, path_problem
from seampact.ir.bundle.printable_url import printable_url
from seampact.ir.bundle.source import GitSource
from seampact.ir.bundle.text import quoted
from seampact.ir.config.config_path import resolve_config_path
from seampact.ir.config.local_source_policy import LocalSourcePolicy

TIMEOUT_SECONDS: Final = 60.0
_TEMPORARY_PREFIX: Final = "seampact-git-"
_FETCHED: Final = "FETCH_HEAD"
_REGULAR_FILE_MODES: Final = ("100644", "100755")
_URL_SCHEME: Final = re.compile(r"([A-Za-z][A-Za-z0-9+.-]*)://")
_DRIVE_PATH: Final = re.compile(r"[A-Za-z]:[\\/]")
# `[user@]host:path`, git's scp-like ssh form: a colon before any slash, after a host longer than a drive letter.
_SCP_LIKE: Final = re.compile(r"[^/:]{2,}:")
_REMOTE_PROTOCOLS: Final = "https:ssh"
_LOCAL_PROTOCOL: Final = "file"
# ssh would otherwise ask for a host key or a passphrase on the terminal, which `GIT_TERMINAL_PROMPT` does not cover.
_NON_INTERACTIVE_SSH: Final = "ssh -o BatchMode=yes"
_REPOSITORY_LOCATING_VARIABLES: Final = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_QUARANTINE_PATH",
)


class _GitFailedError(Exception):
    pass


def git_source_problem(source: GitSource, local_sources: LocalSourcePolicy) -> BundleFailure | None:
    """Why the source cannot be fetched before any git command runs: its URL, its tag, its directory."""
    shown_url = quoted(printable_url(source.url))
    scheme = _scheme_of(source.url)

    if scheme is not None and scheme not in ("https", "ssh", _LOCAL_PROTOCOL):
        return BundleFailure(
            BundleFailureCode.GIT_URL,
            f"The git URL {shown_url} uses '{scheme}:'; a bundle is fetched over https: or ssh only.",
            "Name the repository by its https: or ssh URL.",
        )

    if _is_local_repository(source.url) and local_sources is LocalSourcePolicy.REFUSE:
        return BundleFailure(
            BundleFailureCode.SOURCE_LOCAL,
            f"The git repository {shown_url} is local, and local sources are refused here.",
            "Name the repository by its https: or ssh URL.",
        )

    if _directory_prefix(source.directory) is None:
        return BundleFailure(
            BundleFailureCode.GIT_DIRECTORY,
            f"The git directory {quoted(source.directory or '')} is not a relative path inside the repository.",
            "Name the bundle directory relative to the repository root, without '.', '..' or a backslash.",
        )

    if source.tag.startswith("-") or ".." in source.tag:
        return BundleFailure(
            BundleFailureCode.GIT_TAG,
            f"The git tag {quoted(source.tag)} is not a tag name.",
            "Name the tag the bundle was committed under.",
        )

    return None


class GitFetch:
    def __init__(self, environment: Mapping[str, str], timeout_seconds: float = TIMEOUT_SECONDS) -> None:
        """`environment` holds the variables of this process, which git reads."""
        self._environment = environment
        self._timeout_seconds = timeout_seconds

    def fetch(
        self, source: GitSource, base_directory: str, local_sources: LocalSourcePolicy
    ) -> BundleFiles | BundleFailure:
        """The files of the bundle directory of the tag's tree, or why they could not be fetched. `base_directory` is
        where a local path is relative to."""
        problem = git_source_problem(source, local_sources)

        if problem is not None:
            return problem

        prefix = _directory_prefix(source.directory) or ""
        temporary = tempfile.mkdtemp(prefix=_TEMPORARY_PREFIX)
        repository = os.path.join(temporary, "repository")
        environment = self._git_environment(local_sources)

        try:
            self._git(repository, environment, ["init", "--quiet", "--bare"])
            self._git(
                repository,
                environment,
                [
                    "fetch",
                    "--quiet",
                    "--depth",
                    "1",
                    "--no-tags",
                    "--",
                    _repository_url(source.url, base_directory),
                    f"refs/tags/{source.tag}",
                ],
            )

            return self._tree_files(repository, environment, prefix)
        except _GitFailedError as error:
            return BundleFailure(
                BundleFailureCode.GIT_FAILED,
                f"Fetching tag '{source.tag}' of {quoted(printable_url(source.url))} with git failed: "
                f"{quoted(str(error))}.",
                "Check the URL, the tag and your access to the repository, and that `git` is on the PATH.",
            )
        finally:
            shutil.rmtree(temporary, ignore_errors=True)

    def _git_environment(self, local_sources: LocalSourcePolicy) -> dict[str, str]:
        """The user's environment, less every variable that would point git elsewhere."""
        environment = {
            name: value for name, value in self._environment.items() if name not in _REPOSITORY_LOCATING_VARIABLES
        }
        environment["GIT_ALLOW_PROTOCOL"] = (
            f"{_REMOTE_PROTOCOLS}:{_LOCAL_PROTOCOL}" if local_sources is LocalSourcePolicy.ALLOW else _REMOTE_PROTOCOLS
        )
        environment["GIT_TERMINAL_PROMPT"] = "0"
        environment["GIT_SSH_COMMAND"] = self._environment.get("GIT_SSH_COMMAND", _NON_INTERACTIVE_SSH)

        return environment

    def _tree_files(self, repository: str, environment: dict[str, str], prefix: str) -> BundleFiles | BundleFailure:
        listing = self._git(repository, environment, ["ls-tree", "-r", "-z", "--full-tree", _FETCHED])
        object_ids = _tree_object_ids(listing.decode("utf-8", errors="surrogateescape"), prefix)

        if isinstance(object_ids, BundleFailure):
            return object_ids

        contents: dict[str, bytes] = {}
        total = 0

        for path, object_id in object_ids.items():
            data = self._git(repository, environment, ["cat-file", "blob", object_id])
            total += len(data)

            if total > EXTRACTED_BYTES_MAX:
                return BundleFailure(
                    BundleFailureCode.ARCHIVE_EXTRACTED_TOO_LARGE,
                    f"The tag's bundle files hold more than {EXTRACTED_BYTES_MAX} bytes.",
                    NOT_A_BUNDLE_FIX,
                    expected=str(EXTRACTED_BYTES_MAX),
                )

            contents[path] = data

        return BundleFiles({path: len(data) for path, data in contents.items()}, lambda path: contents[path])

    def _git(self, repository: str, environment: dict[str, str], arguments: list[str]) -> bytes:
        """Runs `git` on the temporary repository, with an argument list (no shell), and returns its output."""
        command = ["git", "-c", "protocol.ext.allow=never", f"--git-dir={repository}", *arguments]

        try:
            completed = subprocess.run(
                command,
                env=environment,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=self._timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise _GitFailedError(f"it took over {round(self._timeout_seconds * 1000)} ms") from error
        except OSError as error:
            raise _GitFailedError(f"git could not start ({error})") from error

        if completed.returncode != 0:
            errors = completed.stderr.decode("utf-8", errors="replace").strip()

            raise _GitFailedError(errors or f"it exited with {completed.returncode}")

        if len(completed.stdout) > EXTRACTED_BYTES_MAX:
            raise _GitFailedError(f"it wrote more than {EXTRACTED_BYTES_MAX} bytes")

        return completed.stdout


def _scheme_of(url: str) -> str | None:
    match = _URL_SCHEME.match(url)

    return match.group(1).lower() if match else None


def _is_local_repository(url: str) -> bool:
    scheme = _scheme_of(url)

    if scheme is not None:
        return scheme == _LOCAL_PROTOCOL

    return _DRIVE_PATH.match(url) is not None or _SCP_LIKE.match(url) is None


def _repository_url(url: str, base_directory: str) -> str:
    """A local path as a `file:` URL, relative to the base directory; any other URL as written."""
    if not _is_local_repository(url) or _scheme_of(url) is not None:
        return url

    path = resolve_config_path(base_directory, url)

    # A drive path takes a third slash: `file:///C:/repository`.
    return "file://" + (path if path.startswith("/") else f"/{path}")


def _directory_prefix(directory: str | None) -> str | None:
    """`directory` as a tree path prefix (`''` for the root, else `a/b/`), or None when it is not a plain relative
    path."""
    if directory is None:
        return ""

    segments = directory.rstrip("/").split("/")

    if any(segment in ("", ".", "..") or "\\" in segment for segment in segments):
        return None

    return "/".join(segments) + "/"


def _tree_object_ids(listing: str, prefix: str) -> dict[str, str] | BundleFailure:
    """Each file below `prefix` and its object id, each checked."""
    object_ids: dict[str, str] = {}
    folded: set[str] = set()

    for line in listing.split("\0"):
        header, tab, full_path = line.partition("\t")

        if not line or not tab or not full_path.startswith(prefix):
            continue

        mode, kind, object_id = ([*header.split(" "), "", "", ""])[:3]
        path = full_path[len(prefix) :]
        failure = _entry_failure(path, mode, kind, folded)

        if failure is not None:
            return failure

        folded.add(fold(path))
        object_ids[path] = object_id

        if len(object_ids) > ENTRIES_MAX:
            return BundleFailure(
                BundleFailureCode.ARCHIVE_TOO_MANY_ENTRIES,
                f"The tag's bundle directory holds more than {ENTRIES_MAX} files.",
                NOT_A_BUNDLE_FIX,
                expected=str(ENTRIES_MAX),
            )

    return object_ids


def _entry_failure(path: str, mode: str, kind: str, folded: set[str]) -> BundleFailure | None:
    shown = quoted(path)

    if kind != "blob" or mode not in _REGULAR_FILE_MODES:
        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_TYPE,
            f"{shown} is a link or a submodule in the tag's tree; a bundle holds regular files only.",
            "Commit the bundle's files as regular files.",
            path,
        )

    problem = None if path == MANIFEST_FILE else path_problem(path)

    if problem is not None:
        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_PATH,
            f"{shown} in the tag's tree is not a bundle path: {problem}.",
            "Point `directory` at the bundle directory, which holds the manifest, `sources/` and `ir/` only.",
            path,
        )

    if fold(path) in folded:
        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_DUPLICATE,
            f"{shown} differs only by letter case from another file of the tag's tree.",
            "Keep one of the two files.",
            path,
        )

    return None

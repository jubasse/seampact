"""The POSIX cache rule, on the real path of the cache root: the copy, its directory and each directory up to the
cache root are owned by the current user, are not links and are not writable by group or others. Each directory
above the cache root, up to the filesystem root, is owned by the current user or by root, is not a link and is not
writable by others; it may be writable by its group only when that group is the running process's primary group,
since whoever can write there can already change the build tool's own files. No account database is read."""

import os
import stat
from dataclasses import dataclass
from typing import Final, Protocol

from seampact.ir.binary.cache_safety import unsafe_cache_path

_OWNER_ONLY: Final = 0o700
_GROUP_WRITE: Final = 0o020
_OTHER_WRITE: Final = 0o002
_ROOT_UID: Final = 0
_MODE_BITS: Final = 0o7777


@dataclass(frozen=True, slots=True)
class PathFact:
    """What the POSIX cache rule reads of one path, from `lstat`: a link is never followed."""

    is_link: bool
    owner_uid: int
    group_id: int
    mode: int


class PathFacts(Protocol):
    """The file facts the POSIX cache rule reads, injected so the rule is tested without a second user."""

    def of(self, path: str) -> PathFact | None:
        """The facts of `path`, or `None` when nothing is there."""
        ...

    def current_uid(self) -> int: ...

    def current_gid(self) -> int:
        """The primary group id of the running process."""
        ...


class PosixPathFacts:
    """The facts of the running system: `lstat`, and the effective user id and primary group id of `os`."""

    def of(self, path: str) -> PathFact | None:
        try:
            status = os.lstat(path)
        except OSError:
            # Missing, or not readable: either way nothing safe is there, and the rule names the path.
            return None

        return PathFact(stat.S_ISLNK(status.st_mode), status.st_uid, status.st_gid, status.st_mode & _MODE_BITS)

    def current_uid(self) -> int:
        return os.geteuid()

    def current_gid(self) -> int:
        return os.getgid()


class PosixCacheSafety:
    def __init__(self, facts: PathFacts | None = None) -> None:
        self._facts = facts if facts is not None else PosixPathFacts()

    def create_private_directory(self, directory: str) -> None:
        missing: list[str] = []
        path = directory

        while self._facts.of(path) is None and os.path.dirname(path) != path:
            missing.append(path)
            path = os.path.dirname(path)

        for path in reversed(missing):
            self._create_private(path)

    def refuse_unsafe(self, copy_path: str, cache_root: str) -> None:
        uid = self._facts.current_uid()
        path = copy_path

        while True:
            self._refuse_unsafe_entry(path, uid)

            if path == cache_root or os.path.dirname(path) == path:
                break

            path = os.path.dirname(path)

        gid = self._facts.current_gid()
        path = os.path.dirname(cache_root)

        while True:
            self._refuse_unsafe_ancestor(path, uid, gid)

            if os.path.dirname(path) == path:
                break

            path = os.path.dirname(path)

    def _create_private(self, path: str) -> None:
        try:
            os.mkdir(path, _OWNER_ONLY)
        except OSError as error:
            # Another run may have created it first; the checks before each start read its modes.
            if self._facts.of(path) is None:
                raise unsafe_cache_path(
                    path, f"cannot be created ({error})", "Check that your user can write its parent directory."
                ) from error

            return

        # mkdir applies the umask; chmod does not.
        try:
            os.chmod(path, _OWNER_ONLY)
        except OSError as error:
            raise unsafe_cache_path(path, f"cannot be made private ({error})", f"Run `chmod 700 '{path}'`.") from error

    def _refuse_unsafe_entry(self, path: str, uid: int) -> None:
        fact = self._facts.of(path)

        if fact is None:
            raise unsafe_cache_path(path, "is missing", "Run seampact again; it installs the binary into its cache.")

        if fact.is_link:
            raise unsafe_cache_path(path, "is a link", f"Remove the link '{path}'; seampact recreates its cache.")

        if fact.owner_uid != uid:
            raise unsafe_cache_path(
                path,
                f"is owned by the user id {fact.owner_uid}, not yours ({uid})",
                "Use a cache directory private to your user (XDG_CACHE_HOME).",
            )

        if fact.mode & (_GROUP_WRITE | _OTHER_WRITE):
            raise unsafe_cache_path(
                path, f"is writable by group or others (mode {fact.mode:o})", f"Run `chmod 700 '{path}'`."
            )

    def _refuse_unsafe_ancestor(self, path: str, uid: int, gid: int) -> None:
        fact = self._facts.of(path)

        if fact is None:
            raise unsafe_cache_path(path, "is missing", "Check that the cache directory exists.")

        # The cache root is a real path: a link above it now was put there after it was resolved.
        if fact.is_link:
            raise unsafe_cache_path(
                path, "is a link", "Use a cache directory whose parents are not links (XDG_CACHE_HOME)."
            )

        if fact.owner_uid not in (uid, _ROOT_UID):
            raise unsafe_cache_path(
                path,
                f"is owned by the user id {fact.owner_uid}, neither yours nor root",
                "Use a cache directory whose parents only you or root can write (XDG_CACHE_HOME).",
            )

        if fact.mode & _OTHER_WRITE:
            raise unsafe_cache_path(
                path,
                f"is writable by others (mode {fact.mode:o})",
                "Use a cache directory private to your user (XDG_CACHE_HOME).",
            )

        if fact.mode & _GROUP_WRITE and fact.group_id != gid:
            raise unsafe_cache_path(
                path,
                f"is writable by its group {fact.group_id} (mode {fact.mode:o}), which is not the primary group of "
                f"this process ({gid})",
                f"Run `chmod g-w '{path}'`, or use a cache directory private to your user (XDG_CACHE_HOME).",
            )

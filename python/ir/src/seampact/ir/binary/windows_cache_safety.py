"""The Windows cache rule, which replaces both POSIX owner rules: from the copy up to the user profile directory
(`%USERPROFILE%`), which Windows creates private, or up to the drive root for a cache outside the profile, no path is
a reparse point and the ACL of each grants write to no account but the current user, SYSTEM and Administrators. The
cache root needs no special case: the rule reads up to the profile or the drive root."""

import os
import re
from collections.abc import Mapping
from typing import Final

from seampact.ir.binary.cache_safety import unsafe_cache_path
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.windows_path_facts import PowerShellPathFacts, WindowsPathFacts

_SYSTEM_SID: Final = "S-1-5-18"
_ADMINISTRATORS_SID: Final = "S-1-5-32-544"
_OWNER_ONLY: Final = 0o700
_DRIVE_ROOT: Final = re.compile(r"[A-Za-z]:\\?\Z")
_SHARE_ROOT: Final = re.compile(r"\\\\[^\\]+\\[^\\]+\Z")
_DRIVE_ONLY: Final = re.compile(r"[A-Za-z]:\Z")


class WindowsCacheSafety:
    def __init__(self, user_profile: str, facts: WindowsPathFacts | None = None) -> None:
        self._user_profile = user_profile
        self._facts = facts if facts is not None else PowerShellPathFacts()

    def create_private_directory(self, directory: str) -> None:
        try:
            os.makedirs(directory, _OWNER_ONLY, exist_ok=True)
        except OSError as error:
            raise unsafe_cache_path(
                directory, f"cannot be created ({error})", "Check that your user can write %LOCALAPPDATA%."
            ) from error

    def refuse_unsafe(self, copy_path: str, cache_root: str) -> None:
        paths = self._paths_up_to_profile(copy_path)
        fix = (
            "Keep %LOCALAPPDATA%\\seampact private to your user: remove the write rights of every other account."
            if self._is_under_profile(copy_path)
            else "Keep the binary cache under %LOCALAPPDATA%, which only your user can write."
        )
        facts = self._facts.of(paths)
        allowed = {self._facts.current_user_sid(), _SYSTEM_SID, _ADMINISTRATORS_SID}

        for path in paths:
            fact = facts.get(path)

            if fact is None:
                raise unsafe_cache_path(
                    path, "is missing", "Run seampact again; it installs the binary into its cache."
                )

            if fact.is_reparse_point:
                raise unsafe_cache_path(
                    path, "is a reparse point (a link or a junction)", f"Remove '{path}'; seampact recreates its cache."
                )

            others = [sid for sid in fact.writer_sids if sid not in allowed]

            if others:
                raise unsafe_cache_path(path, f"lets {', '.join(others)} write it", fix)

    def _paths_up_to_profile(self, copy_path: str) -> list[str]:
        """The copy, then each parent up to the profile directory or the drive root included."""
        profile = _normalized(self._user_profile)
        paths: list[str] = []
        path = _normalized(copy_path)

        while True:
            paths.append(path)

            if path.lower() == profile.lower() or _parent_of(path) == path:
                return paths

            path = _parent_of(path)

    def _is_under_profile(self, copy_path: str) -> bool:
        profile = _normalized(self._user_profile) + "\\"

        return (_normalized(copy_path) + "\\").lower().startswith(profile.lower())


def _normalized(path: str) -> str:
    return path.replace("/", "\\").rstrip("\\")


def _parent_of(path: str) -> str:
    """The parent of a path without a trailing backslash; a drive root (`C:\\`) or a share root is its own parent."""
    if _DRIVE_ROOT.match(path) or _SHARE_ROOT.match(path):
        return path

    parent = path.rpartition("\\")[0] if "\\" in path else ""

    if parent == "":
        return path

    return f"{parent}\\" if _DRIVE_ONLY.match(parent) else parent


def locate_user_profile(environment: Mapping[str, str]) -> str:
    """The Windows user profile directory (`%USERPROFILE%`), resolved to its real path as the cache root is, so a
    profile reached through a junction or a short (8.3) name is not misread as outside the profile."""
    profile = environment.get("USERPROFILE", "")

    if profile == "":
        raise BinaryRefusedError(
            BinaryFailureCode.CACHE_UNAVAILABLE,
            "USERPROFILE is not set, so the ACL of the binary cache cannot be checked up to the user profile.",
            "Run seampact as a Windows user with a profile.",
        )

    try:
        return os.path.realpath(profile, strict=True)
    except OSError as error:
        raise BinaryRefusedError(
            BinaryFailureCode.CACHE_UNAVAILABLE,
            f"USERPROFILE is '{profile}', which cannot be resolved to its real path ({error}), so the ACL of the "
            "binary cache cannot be checked up to it.",
            "Run seampact as a Windows user whose profile directory exists and is readable.",
        ) from error

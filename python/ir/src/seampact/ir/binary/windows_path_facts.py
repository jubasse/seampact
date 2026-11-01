"""The Windows facts the cache rule reads, through Windows PowerShell (`Get-Item`, `Get-Acl`), by SID so no account
name depends on the system language. A write right is any right to write data, add a file or a folder, delete, or
change the permissions or the owner, generic write and generic all included."""

import json
import os
import subprocess
from dataclasses import dataclass
from typing import Final, Protocol

from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError

# WriteData 0x2, AppendData 0x4, DeleteSubdirectoriesAndFiles 0x40, Delete 0x10000, ChangePermissions 0x40000,
# TakeOwnership 0x80000, GENERIC_ALL 0x10000000, GENERIC_WRITE 0x40000000.
_WRITE_RIGHTS: Final = 0x2 | 0x4 | 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000
_PATHS_VARIABLE: Final = "SEAMPACT_ACL_PATHS"
_SCRIPT: Final = """
$ErrorActionPreference = 'Stop'
$paths = ConvertFrom-Json $env:SEAMPACT_ACL_PATHS
$facts = @()
foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $item = Get-Item -LiteralPath $path -Force
    $writers = @()
    foreach ($entry in (Get-Acl -LiteralPath $path).Access) {
        $rights = [long]$entry.FileSystemRights
        if ($entry.AccessControlType -eq 'Allow' -and ($rights -band WRITE_RIGHTS) -ne 0) {
            $writers += $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        }
    }
    $reparse = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    $facts += @{ path = $path; reparse = $reparse; writers = @($writers) }
}
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
ConvertTo-Json -Compress -Depth 4 @{ user = $user; facts = @($facts) }
""".replace("WRITE_RIGHTS", str(_WRITE_RIGHTS))


@dataclass(frozen=True, slots=True)
class WindowsPathFact:
    """What the Windows cache rule reads of one path: a reparse point, and the SIDs its ACL lets write."""

    is_reparse_point: bool
    writer_sids: tuple[str, ...]


class WindowsPathFacts(Protocol):
    """The file facts the Windows cache rule reads, injected so the rule is tested on any system."""

    def of(self, paths: list[str]) -> dict[str, WindowsPathFact]:
        """The facts of each path, by path; a missing path is absent from the result."""
        ...

    def current_user_sid(self) -> str: ...


class PowerShellPathFacts:
    def __init__(self) -> None:
        self._last_read: dict[str, object] | None = None

    def of(self, paths: list[str]) -> dict[str, WindowsPathFact]:
        return facts_of_output(self._read(paths))

    def current_user_sid(self) -> str:
        user = (self._last_read if self._last_read is not None else self._read([])).get("user")

        if not isinstance(user, str):
            raise _unreadable("the current user has no SID")

        return user

    def _read(self, paths: list[str]) -> dict[str, object]:
        system_root = os.environ.get("SYSTEMROOT", "")

        if system_root == "":
            raise _unreadable("SystemRoot is not set, so Windows PowerShell cannot be found")

        command = [
            f"{system_root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            *("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"),
            *("-Command", _SCRIPT),
        ]
        environment = {**os.environ, _PATHS_VARIABLE: json.dumps(paths)}

        try:
            completed = subprocess.run(command, env=environment, capture_output=True, text=True, check=False)
        except OSError as error:
            raise _unreadable(f"Windows PowerShell does not start ({error})") from error

        try:
            read = json.loads(completed.stdout)
        except ValueError:
            read = None

        if completed.returncode != 0 or not isinstance(read, dict):
            raise _unreadable(f"Windows PowerShell exited with {completed.returncode}: {completed.stderr.strip()}")

        self._last_read = read

        return read


def facts_of_output(read: dict[str, object]) -> dict[str, WindowsPathFact]:
    """The facts of the reader's JSON output, by path. Any other shape than the script writes is refused, so an
    unexpected output never reads as a safe path."""
    entries = read.get("facts")

    if not isinstance(entries, list):
        raise _unreadable("the output of Windows PowerShell has no `facts` list")

    facts: dict[str, WindowsPathFact] = {}

    for fact in entries:
        if not (
            isinstance(fact, dict)
            and isinstance(fact.get("path"), str)
            and isinstance(fact.get("reparse"), bool)
            and isinstance(fact.get("writers"), list)
        ):
            raise _unreadable(
                "an entry of the output of Windows PowerShell is not a path, a reparse flag and a list of writers"
            )

        writers = fact["writers"]

        if not all(isinstance(writer, str) for writer in writers):
            raise _unreadable(f"a writer of '{fact['path']}' in the output of Windows PowerShell is not a SID")

        facts[fact["path"]] = WindowsPathFact(fact["reparse"], tuple(writers))

    return facts


def _unreadable(problem: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.CACHE_UNSAFE,
        f"The ACL of the binary cache cannot be read: {problem}.",
        "Run seampact where Windows PowerShell can read the ACL of %LOCALAPPDATA%\\seampact.",
    )

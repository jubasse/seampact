"""Refuses a `[tool.seampact.binary]` table set outside the root project (`binary.override-not-root`), so a
dependency never chooses the binary the build runs. The sources it reads are the pyproject files a Python build can
reach: the members of the root's uv workspace and the local directories installed distributions record in
`direct_url.json` (path dependencies, editable installs)."""

import glob
import json
import os
from collections.abc import Iterator
from importlib import metadata
from typing import Final
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.root_project import PYPROJECT_FILE, RootProject, tool_table
from seampact.ir.https.untrusted_text import quoted

_FILE_SCHEME: Final = "file"
_DIRECT_URL_FILE: Final = "direct_url.json"


def refuse_dependency_overrides(root: RootProject) -> None:
    root_file = os.path.realpath(root.pyproject_file)

    for name, pyproject_file in _reachable_pyproject_files(root):
        if os.path.realpath(pyproject_file) == root_file:
            continue

        tool = tool_table(pyproject_file)
        seampact = tool.get("seampact")

        if isinstance(seampact, dict) and "binary" in seampact:
            raise BinaryRefusedError(
                BinaryFailureCode.OVERRIDE_NOT_ROOT,
                f"'{pyproject_file}' of {name} sets `tool.seampact.binary`; only the root project's "
                f"'{root.pyproject_file}' chooses the compiler binary.",
                f"Remove the table from '{pyproject_file}', or set the override in your own {PYPROJECT_FILE}.",
            )


def _reachable_pyproject_files(root: RootProject) -> Iterator[tuple[str, str]]:
    yield from _workspace_members(root)
    yield from _local_installs()


def _workspace_members(root: RootProject) -> Iterator[tuple[str, str]]:
    if not os.path.isfile(root.pyproject_file):
        return

    workspace = _table(_table(tool_table(root.pyproject_file).get("uv")).get("workspace"))
    members = workspace.get("members", [])

    for pattern in members if isinstance(members, list) else []:
        for directory in sorted(glob.glob(os.path.join(root.directory, str(pattern)))):
            pyproject_file = os.path.join(directory, PYPROJECT_FILE)

            if os.path.isfile(pyproject_file):
                yield f"the workspace member {quoted(os.path.basename(directory))}", pyproject_file


def _local_installs() -> Iterator[tuple[str, str]]:
    for distribution in metadata.distributions():
        recorded = distribution.read_text(_DIRECT_URL_FILE)
        url = _local_directory_url(recorded)

        if url is None:
            continue

        pyproject_file = os.path.join(url2pathname(unquote(urlparse(url).path)), PYPROJECT_FILE)

        if os.path.isfile(pyproject_file):
            yield f"the installed package {quoted(distribution.metadata['Name'])}", pyproject_file


def _local_directory_url(recorded: str | None) -> str | None:
    if recorded is None:
        return None

    try:
        direct_url = json.loads(recorded)
    except ValueError:
        # A malformed record belongs to the installer that wrote it; it names no local directory.
        return None

    url = direct_url.get("url") if isinstance(direct_url, dict) else None

    return url if isinstance(url, str) and url.startswith(f"{_FILE_SCHEME}:") and "dir_info" in direct_url else None


def _table(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}

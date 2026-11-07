"""What the writer keeps in a target's output directory (ADR 0015 "Writing files"), as `manifest.ts`: the target that
owns the directory, and each file it generated with the SHA-256 of its bytes, in code-unit order of path. The Node
writer, the JVM writer and this one read and write the same file."""

import json
import os
import re
from dataclasses import dataclass
from typing import Final

from seampact.ir.write.code_unit_order import code_unit_key
from seampact.ir.write.safe_path import unsafe_path_reason

MANIFEST_FILE_NAME: Final = ".seampact-manifest.json"
_SHA256_HEX: Final = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True, slots=True)
class WriterManifest:
    owner: str | None
    hash_by_path: dict[str, str]


def read_manifest(root_dir: str) -> WriterManifest | str:
    """The manifest of `root_dir`, or why it cannot be read; a missing one is empty, with no owner (a first run)."""
    file = os.path.join(root_dir, MANIFEST_FILE_NAME)

    if not os.path.exists(file):
        return WriterManifest(None, {})

    try:
        with open(file, encoding="utf-8") as handle:
            parsed = json.load(handle)
    except (OSError, UnicodeDecodeError):
        return "it cannot be read"
    except ValueError as error:
        return f"it is not JSON ({error})"

    files = parsed.get("files") if isinstance(parsed, dict) else None

    if not isinstance(files, list):
        return "it has no `files` array"

    owner = parsed.get("owner")

    if not isinstance(owner, str):
        return "it has no `owner` target id"

    return _entries(owner, files)


def _entries(owner: str, files: list[object]) -> WriterManifest | str:
    hash_by_path: dict[str, str] = {}

    for entry in files:
        path = entry.get("path") if isinstance(entry, dict) else None
        sha256 = entry.get("sha256") if isinstance(entry, dict) else None

        if not isinstance(path, str) or not isinstance(sha256, str):
            return "an entry is not `{ path, sha256 }` strings"

        if not _SHA256_HEX.match(sha256):
            return f"the hash of '{path}' is not a SHA-256 hex digest"

        if path in hash_by_path:
            return f"'{path}' is listed twice"

        unsafe = unsafe_path_reason(path)

        if unsafe is not None:
            return f"the path '{path}' is unsafe: {unsafe}"

        hash_by_path[path] = sha256

    return WriterManifest(owner, hash_by_path)


def serialized_manifest(owner: str, hash_by_path: dict[str, str]) -> str:
    """The manifest's text, byte for byte the Node writer's `JSON.stringify(..., null, 2)` and a final newline."""
    ordered = sorted(hash_by_path, key=code_unit_key)
    entries = [
        f'    {{\n      "path": {_json_string(path)},\n      "sha256": {_json_string(hash_by_path[path])}\n    }}'
        for path in ordered
    ]
    files_block = "[]" if not entries else "[\n" + ",\n".join(entries) + "\n  ]"

    return f'{{\n  "owner": {_json_string(owner)},\n  "files": {files_block}\n}}\n'


def _json_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)

"""The bundle integrity: one line per listed file, `<sha256 lowercase hex>  <path>\\n`, sorted by path in code-unit
order, the manifest excluded, encoded as UTF-8; the integrity is `sha256-` and the padded standard base64 of its
SHA-256, the SRI form npm uses."""

import base64
import hashlib
from collections.abc import Iterable
from typing import Final

from seampact.ir.bundle.manifest import BundleFile

_PREFIX: Final = "sha256-"


def bundle_integrity(files: Iterable[BundleFile]) -> str:
    ordered = sorted(files, key=lambda file: file.path.encode("utf-16-be"))
    canonical_list = "".join(f"{file.sha256}  {file.path}\n" for file in ordered)
    digest = hashlib.sha256(canonical_list.encode("utf-8")).digest()

    return _PREFIX + base64.b64encode(digest).decode("ascii")

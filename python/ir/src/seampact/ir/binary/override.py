"""The root project's `[tool.seampact.binary]`: a local `path` with its `sha256`; a `version` with the `sha256` of
every release asset; or a mirror `url` (a base to which `/<asset>` is appended) with the `sha256` of every asset,
never the embedded ones. A relative `path` resolves against the root `pyproject.toml`'s directory."""

import os
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

from seampact.ir.binary import release_assets
from seampact.ir.binary.absolute_path import is_absolute
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError


class BinaryOverrideSource(StrEnum):
    PATH = "path"
    VERSION = "version"
    URL = "url"


_KEYS: Final = ("path", "version", "url", "sha256")
_FIX: Final = (
    "Give `path` with the `sha256` of that file, or `version` or `url` with a `sha256` table of every release "
    "asset, as the release SHA256SUMS lists them."
)


@dataclass(frozen=True, slots=True)
class BinaryOverride:
    source: BinaryOverrideSource
    value: str
    sha256: str | None
    sha256_by_asset: dict[str, str] = field(default_factory=dict)


def read_binary_override(binary: object, pyproject_file: str) -> BinaryOverride:
    """Raises `binary.pin-missing` or `binary.pin-invalid`. `pyproject_file` is the root `pyproject.toml`, for
    messages and the relative `path`."""
    where = f"`tool.seampact.binary` of '{pyproject_file}'"

    if not isinstance(binary, dict):
        raise _invalid(f"{where} is not a table")

    unknown = [key for key in binary if key not in _KEYS]

    if unknown:
        raise _invalid(f"{where} has the unknown key '{', '.join(unknown)}'")

    sources = [source for source in BinaryOverrideSource if source.value in binary]

    if len(sources) != 1:
        raise _invalid(f"{where} must set exactly one of `path`, `version` and `url`")

    source = sources[0]
    value = binary[source.value]

    if not isinstance(value, str) or value == "":
        raise _invalid(f"{where} has a `{source.value}` that is not a non-empty string")

    hashes = binary.get("sha256")

    if hashes is None:
        raise _missing(f"{where} gives no `sha256`")

    if source is BinaryOverrideSource.PATH:
        resolved = value if is_absolute(value) else os.path.join(os.path.dirname(pyproject_file), value)

        return BinaryOverride(source, resolved, _file_hash(hashes, where))

    if not isinstance(hashes, dict):
        raise _invalid(f"{where} has a `sha256` that is not a table of one hash per release asset")

    return BinaryOverride(source, value, None, hashes_of_every_asset(hashes, where))


def hashes_of_every_asset(hashes: dict[str, object], where: str) -> dict[str, str]:
    """One valid hash per release asset and no other key. Raises `binary.pin-invalid` or `binary.pin-missing`."""
    by_asset: dict[str, str] = {}

    for asset, hash_value in hashes.items():
        if asset not in release_assets.BINARIES:
            raise _invalid(
                f"{where} has a hash for '{asset}', which is no release binary ({', '.join(release_assets.BINARIES)})"
            )

        by_asset[asset] = _file_hash(hash_value, f"{where}, asset '{asset}',")

    missing = [asset for asset in release_assets.BINARIES if asset not in by_asset]

    if missing:
        raise _missing(f"{where} has no hash for '{"', '".join(missing)}'")

    return by_asset


def _file_hash(hash_value: object, where: str) -> str:
    if not release_assets.is_sha256(hash_value):
        raise _invalid(f"{where} has a `sha256` that is not 64 lowercase hexadecimal digits")

    return hash_value


def _invalid(problem: str) -> BinaryRefusedError:
    return BinaryRefusedError(BinaryFailureCode.PIN_INVALID, f"The binary override is invalid: {problem}.", _FIX)


def _missing(problem: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.PIN_MISSING,
        f"The binary override is not pinned: {problem}; seampact never runs a binary it cannot check.",
        _FIX,
    )

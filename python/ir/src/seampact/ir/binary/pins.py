"""The pin `seampact-ir` ships in `binaries.json`: the binary version and one SHA-256 per release asset, written at
release time from the release `SHA256SUMS`. Until the compiler is published it holds no version and no hash."""

import json
from dataclasses import dataclass
from importlib import resources

from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.override import hashes_of_every_asset

_RESOURCE = "binaries.json"
# The version of every package of the checkout until the release stamps it: a pin at it hashes no released binary.
_DEVELOPMENT_VERSION = "0.0.0"


@dataclass(frozen=True, slots=True)
class BinaryPins:
    version: str
    sha256_by_asset: dict[str, str]


def embedded_pins(text: str | None = None) -> BinaryPins | None:
    """The embedded pins (or the pins of `text`), or `None` while they are empty (before publication). Raises
    `binary.pin-invalid` when the file is not a version with every asset's hash, or pins the development version."""
    source = text if text is not None else (resources.files("seampact.ir.binary") / _RESOURCE).read_text("utf-8")

    try:
        pins = json.loads(source)
    except ValueError as error:
        raise _invalid(f"'{_RESOURCE}' is not JSON ({error})") from error

    if not isinstance(pins, dict) or "version" not in pins or "sha256" not in pins:
        raise _invalid(f"'{_RESOURCE}' is not a JSON object with `version` and `sha256`")

    version = pins["version"]
    hashes = pins["sha256"]

    if version is None and hashes == {}:
        return None

    if not isinstance(version, str) or version == "" or not isinstance(hashes, dict):
        raise _invalid(f"'{_RESOURCE}' has no version string or no `sha256` object")

    if version == _DEVELOPMENT_VERSION:
        raise _invalid(f"'{_RESOURCE}' pins version {_DEVELOPMENT_VERSION}, a development pin of no released binary")

    return BinaryPins(version, hashes_of_every_asset(hashes, f"'{_RESOURCE}'"))


def _invalid(problem: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.PIN_INVALID,
        f"The binary pins of seampact-ir are unreadable: {problem}.",
        "Reinstall seampact-ir; its pins are written at release time from the release SHA256SUMS.",
    )

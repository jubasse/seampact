"""The binary a `seampact-compiler` platform wheel installed: the release asset, unchanged, under
`seampact/compiler/bin/` of the environment. The file is only a source: `install_binary` hashes it against the pin
and runs a private copy, never this file."""

import os
from importlib import metadata
from typing import Final

COMPILER_DISTRIBUTION: Final = "seampact-compiler"
_BINARY_DIRECTORY: Final = ("seampact", "compiler", "bin")


def wheel_binary_path(asset: str) -> str | None:
    """The installed file of `asset`, or `None` when the wheel is not installed or lacks it."""
    try:
        distribution = metadata.distribution(COMPILER_DISTRIBUTION)
    except metadata.PackageNotFoundError:
        return None

    path = str(distribution.locate_file(os.path.join(*_BINARY_DIRECTORY, asset)))

    return path if os.path.isfile(path) else None

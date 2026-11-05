"""The build hook of the `seampact-compiler` platform wheels: one release asset per wheel, unchanged, at
`seampact/compiler/bin/<asset>`, checked against the release `SHA256SUMS`, and the wheel tagged with the oldest
platform the embedded Node.js runs on. A release builds the five wheels from the signed assets:

    SEAMPACT_COMPILER_ASSETS=<assets and SHA256SUMS> SEAMPACT_COMPILER_ASSET=seampact-linux-x64 uv build --wheel
"""

import hashlib
import os
from pathlib import Path
from typing import Any, Final

from hatchling.builders.config import BuilderConfig
from hatchling.builders.hooks.plugin.interface import BuildHookInterface

ASSETS_DIRECTORY_VARIABLE: Final = "SEAMPACT_COMPILER_ASSETS"
ASSET_VARIABLE: Final = "SEAMPACT_COMPILER_ASSET"
MANIFEST: Final = "SHA256SUMS"
BINARY_DIRECTORY: Final = "seampact/compiler/bin"
EDITABLE_VERSION: Final = "editable"

# Node.js 24 needs glibc 2.28 on Linux and macOS 13.5. pip tags a macOS from 11 on by its major only, so
# `macosx_13_0` is the closest floor; Node itself refuses macOS 13.0 to 13.4. The build isolation keeps this table
# apart from the other lists of the five asset names, which a rename changes with it:
# `packages/tools/binary/scripts/binary-names.mjs`, `python/ir/src/seampact/ir/binary/release_assets.py` and the
# platform table of `python/ir/src/seampact/ir/binary/host_platform.py`.
WHEEL_TAG_BY_ASSET: Final = {
    "seampact-linux-x64": "py3-none-manylinux_2_28_x86_64",
    "seampact-linux-arm64": "py3-none-manylinux_2_28_aarch64",
    "seampact-darwin-x64": "py3-none-macosx_13_0_x86_64",
    "seampact-darwin-arm64": "py3-none-macosx_13_0_arm64",
    "seampact-win32-x64.exe": "py3-none-win_amd64",
}


class CompilerWheelBuildError(Exception):
    """A wheel the hook refuses to build, with the fix in the message."""


class CompilerWheelHook(BuildHookInterface[BuilderConfig]):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        if self.target_name == "sdist":
            raise CompilerWheelBuildError(
                "seampact-compiler has no sdist, so pip never builds the compiler. Build its platform wheels with "
                f"`uv build --wheel`, {ASSETS_DIRECTORY_VARIABLE} and {ASSET_VARIABLE} set."
            )

        # The workspace's editable install: no binary, so seampact-ir finds none and refuses by name until a
        # `path` override or a released wheel provides one.
        if version == EDITABLE_VERSION:
            return

        asset = _required_variable(ASSET_VARIABLE)
        tag = WHEEL_TAG_BY_ASSET.get(asset)

        if tag is None:
            raise CompilerWheelBuildError(
                f"{ASSET_VARIABLE} is '{asset}', no release binary. Set it to one of {', '.join(WHEEL_TAG_BY_ASSET)}."
            )

        binary = _checked_binary(Path(_required_variable(ASSETS_DIRECTORY_VARIABLE)), asset)

        build_data["pure_python"] = False
        build_data["tag"] = tag
        build_data["force_include"][str(binary)] = f"{BINARY_DIRECTORY}/{asset}"


def _required_variable(name: str) -> str:
    value = os.environ.get(name, "")

    if value == "":
        raise CompilerWheelBuildError(
            f"{name} is not set. A seampact-compiler wheel holds one release binary: set {ASSETS_DIRECTORY_VARIABLE} "
            f"to the directory of the release assets and their {MANIFEST}, and {ASSET_VARIABLE} to the asset."
        )

    return value


def _checked_binary(assets_directory: Path, asset: str) -> Path:
    binary = assets_directory / asset
    manifest = assets_directory / MANIFEST

    if not binary.is_file() or not manifest.is_file():
        raise CompilerWheelBuildError(
            f"{assets_directory} must hold {asset} and {MANIFEST}. Point {ASSETS_DIRECTORY_VARIABLE} at the release "
            "assets, after the macOS signature."
        )

    # pip keeps the executable bit a wheel records, and the file's mode is what the wheel records.
    if not asset.endswith(".exe") and not os.access(binary, os.X_OK):
        raise CompilerWheelBuildError(f"{binary} is not executable. Run `chmod +x` on it before the build.")

    listed = _manifest_hash(manifest, asset)
    actual = hashlib.sha256(binary.read_bytes()).hexdigest()

    if actual != listed:
        raise CompilerWheelBuildError(
            f"{binary} has SHA-256 {actual}, but {MANIFEST} lists {listed}. Build the wheel from the assets the "
            f"{MANIFEST} was written for."
        )

    return binary


def _manifest_hash(manifest: Path, asset: str) -> str:
    for line in manifest.read_text("utf-8").splitlines():
        listed_hash, separator, listed_asset = line.partition("  ")

        if separator and listed_asset == asset:
            return listed_hash

    raise CompilerWheelBuildError(f"{manifest} lists no hash for {asset}. Write it with manifest.mjs after signing.")

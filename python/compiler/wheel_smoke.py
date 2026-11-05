"""The smoke of an installed `seampact-compiler` wheel, run by the Python of a clean venv that holds only it: the
wheel installed one binary, the release asset of this platform unchanged, where `seampact-ir` looks for it, and
the binary answers `--help`.

    <venv python> -I wheel_smoke.py <asset> <directory of the release assets>
"""

import hashlib
import os
import subprocess
import sys
from importlib import metadata
from pathlib import Path

DISTRIBUTION = "seampact-compiler"
BINARY_DIRECTORY = Path("seampact", "compiler", "bin")
HELP_DEADLINE_SECONDS = 60
USAGE_LINE = "Usage: seampact <command> [options]"


def main(asset: str, assets_directory: Path) -> None:
    installed = Path(str(metadata.distribution(DISTRIBUTION).locate_file(BINARY_DIRECTORY)))
    binaries = sorted(path.name for path in installed.iterdir())

    if binaries != [asset]:
        sys.exit(f"wheel smoke: {installed} holds {binaries}, not the one release asset {asset}")

    binary = installed / asset
    installed_hash = _sha256(binary)
    release_hash = _sha256(assets_directory / asset)

    if installed_hash != release_hash:
        sys.exit(f"wheel smoke: the installed {asset} has SHA-256 {installed_hash}, the release asset {release_hash}")

    if os.name != "nt" and not os.access(binary, os.X_OK):
        sys.exit(f"wheel smoke: the installed {binary} is not executable")

    answer = subprocess.run(
        [str(binary), "--help"], capture_output=True, text=True, timeout=HELP_DEADLINE_SECONDS, check=False
    )

    if answer.returncode != 0 or not answer.stdout.startswith(USAGE_LINE):
        sys.exit(f"wheel smoke: `{asset} --help` exited {answer.returncode}\n{answer.stdout}\n{answer.stderr}")

    print(f"wheel smoke: {DISTRIBUTION} installed {asset} unchanged and it answers --help")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))

"""The compiler binary of a Python build: pinned by the root project's `[tool.seampact.binary]` (a dependency's is
refused) or the pins `seampact-ir` embeds, copied into the private content-addressed cache, and run only from there.
The compiler is not published yet (the embedded pin is empty): a `path` override with its hash is the only way to the
binary, and anything else is refused by name (`binary.unpublished`). With a pin, the binary is the file of the
`seampact-compiler` wheel for this host, checked against the pin."""

from collections.abc import Mapping
from typing import Final

from seampact.ir.binary.cache_root import locate_cache_root
from seampact.ir.binary.cache_safety import CacheSafety
from seampact.ir.binary.dependency_overrides import refuse_dependency_overrides
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.host_platform import HostPlatform
from seampact.ir.binary.installed_binary import InstalledBinary
from seampact.ir.binary.installer import install_binary
from seampact.ir.binary.override import BinaryOverrideSource
from seampact.ir.binary.pins import embedded_pins
from seampact.ir.binary.posix_cache_safety import PosixCacheSafety
from seampact.ir.binary.root_project import RootProject
from seampact.ir.binary.wheel import COMPILER_DISTRIBUTION, wheel_binary_path
from seampact.ir.binary.windows_cache_safety import WindowsCacheSafety, locate_user_profile

_FILE_NAME: Final = "seampact"
_WINDOWS_FILE_NAME: Final = "seampact.exe"
_UNPUBLISHED_FIX: Final = (
    'Set [tool.seampact.binary] in your root pyproject.toml to path = "<your build of the compiler>" and '
    'sha256 = "<its SHA-256>", or use a bundle source, which needs no binary.'
)


def install_compiler_binary(
    project_directory: str,
    host: HostPlatform,
    environment: Mapping[str, str],
    safety: CacheSafety | None = None,
) -> InstalledBinary:
    """`environment` holds the variables of this process. `safety` is the host's cache rule unless a test injects
    one. Raises `BinaryRefusedError`."""
    root = RootProject.locate(project_directory)
    refuse_dependency_overrides(root)
    override = root.binary_override()

    if override is None:
        source, sha256 = _wheel_source(host)
    elif override.source is BinaryOverrideSource.PATH and override.sha256 is not None:
        source, sha256 = override.value, override.sha256
    else:
        raise BinaryRefusedError(
            BinaryFailureCode.UNPUBLISHED,
            f"The compiler binary is not published yet, so the `{override.source.value}` override of "
            f"'{root.pyproject_file}' has nothing to download.",
            _UNPUBLISHED_FIX,
        )

    cache_root = locate_cache_root(environment, windows=host.is_windows)
    cache_safety = safety if safety is not None else _host_cache_safety(host, environment)

    return install_binary(
        source, sha256, cache_root, _WINDOWS_FILE_NAME if host.is_windows else _FILE_NAME, cache_safety
    )


def _host_cache_safety(host: HostPlatform, environment: Mapping[str, str]) -> CacheSafety:
    return WindowsCacheSafety(locate_user_profile(environment)) if host.is_windows else PosixCacheSafety()


def _wheel_source(host: HostPlatform) -> tuple[str, str]:
    """The wheel's file for this host and the pinned hash it must have."""
    pins = embedded_pins()

    if pins is None:
        raise BinaryRefusedError(
            BinaryFailureCode.UNPUBLISHED,
            "The compiler binary is not published yet, so this seampact-ir has no binary to run.",
            _UNPUBLISHED_FIX,
        )

    # With pins, the host decides the asset first, so an unsupported host learns its own fixes.
    asset = host.asset_name()
    installed = wheel_binary_path(asset)

    if installed is None:
        raise BinaryRefusedError(
            BinaryFailureCode.UNPUBLISHED,
            f"No installed {COMPILER_DISTRIBUTION} wheel holds '{asset}'.",
            f"Install seampact-ir[compiler] ({COMPILER_DISTRIBUTION} {pins.version}), or point "
            "[tool.seampact.binary] path at your own build of the compiler, with its sha256.",
        )

    return installed, pins.sha256_by_asset[asset]

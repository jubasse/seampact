"""The compiler binary of a Python build: pinned by the root project's `[tool.seampact.binary]` (a dependency's is
refused) or the pins `seampact-ir` embeds, copied or downloaded into the private content-addressed cache, and run only
from there. A `path` override is copied; a `version` override downloads the release asset of this host, and a `url`
override the asset of its mirror. With the embedded pins, the binary is the file of the `seampact-compiler` wheel for
this host. Each is checked against its pin. A development build embeds no pin: without an override it is refused by
name (`binary.unpublished`)."""

from collections.abc import Callable, Mapping
from typing import Final

from seampact.ir.binary.cache_root import locate_cache_root
from seampact.ir.binary.cache_safety import CacheSafety
from seampact.ir.binary.dependency_overrides import refuse_dependency_overrides
from seampact.ir.binary.download import BinaryDownload
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.host_platform import HostPlatform
from seampact.ir.binary.installed_binary import InstalledBinary
from seampact.ir.binary.installer import install_binary, install_downloaded_binary
from seampact.ir.binary.override import BinaryOverride, BinaryOverrideSource
from seampact.ir.binary.pins import embedded_pins
from seampact.ir.binary.posix_cache_safety import PosixCacheSafety
from seampact.ir.binary.root_project import RootProject
from seampact.ir.binary.wheel import COMPILER_DISTRIBUTION, wheel_binary_path
from seampact.ir.binary.windows_cache_safety import WindowsCacheSafety, locate_user_profile

_FILE_NAME: Final = "seampact"
_WINDOWS_FILE_NAME: Final = "seampact.exe"
# Installs the pinned binary into a cache root, under a file name and a cache rule.
_Install = Callable[[str, str, CacheSafety], InstalledBinary]

_UNPUBLISHED_FIX: Final = (
    'Set [tool.seampact.binary] in your root pyproject.toml to path = "<your build of the compiler>" and '
    'sha256 = "<its SHA-256>", or use a bundle source, which needs no binary.'
)


def install_compiler_binary(
    project_directory: str,
    host: HostPlatform,
    environment: Mapping[str, str],
    safety: CacheSafety | None = None,
    download: BinaryDownload | None = None,
) -> InstalledBinary:
    """`environment` holds the variables of this process. `safety` is the host's cache rule and `download` the
    GitHub releases unless a test injects its own. Raises `BinaryRefusedError`."""
    download = download if download is not None else BinaryDownload()
    root = RootProject.locate(project_directory)
    refuse_dependency_overrides(root)
    override = root.binary_override()

    install = _pinned_install(override, host, download)
    cache_root = locate_cache_root(environment, windows=host.is_windows)
    cache_safety = safety if safety is not None else _host_cache_safety(host, environment)

    return install(cache_root, _WINDOWS_FILE_NAME if host.is_windows else _FILE_NAME, cache_safety)


def _pinned_install(override: BinaryOverride | None, host: HostPlatform, download: BinaryDownload) -> _Install:
    """How the pinned binary goes into a cache root: copied from the wheel or a `path`, or downloaded. The pins are
    read before the cache is located."""
    if override is None:
        wheel_file, wheel_sha256 = _wheel_source(host)

        return lambda cache_root, file_name, safety: install_binary(
            wheel_file, wheel_sha256, cache_root, file_name, safety
        )

    # Only a `path` override carries a single hash.
    if override.sha256 is not None:
        path, path_sha256 = override.value, override.sha256

        return lambda cache_root, file_name, safety: install_binary(path, path_sha256, cache_root, file_name, safety)

    asset = host.asset_name()
    url = (
        BinaryDownload.mirror_url(override.value, asset)
        if override.source is BinaryOverrideSource.URL
        else download.release_url(override.value, asset)
    )
    asset_sha256 = override.sha256_by_asset[asset]

    return lambda cache_root, file_name, safety: install_downloaded_binary(
        url, asset_sha256, cache_root, file_name, safety, download
    )


def _host_cache_safety(host: HostPlatform, environment: Mapping[str, str]) -> CacheSafety:
    return WindowsCacheSafety(locate_user_profile(environment)) if host.is_windows else PosixCacheSafety()


def _wheel_source(host: HostPlatform) -> tuple[str, str]:
    """The wheel's file for this host and the pinned hash it must have."""
    pins = embedded_pins()

    if pins is None:
        raise BinaryRefusedError(
            BinaryFailureCode.UNPUBLISHED,
            "This seampact-ir is a development build: it embeds no binary pin, so it has no binary to run.",
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

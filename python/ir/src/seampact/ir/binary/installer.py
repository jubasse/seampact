"""Hashes a `path` source first, so a warm cache never hides a source that changed; a download runs only when the cache
holds no intact entry of its pin. Creates the cache root and resolves its real path once; only that path is checked
and run from then on. Checks the cache before any copy, then copies or downloads a binary into `<cache root>/<sha256>/`:
streamed into a temporary file created exclusively there and hashed as it streams, made executable, then renamed
atomically to its name. An entry already there with the right hash counts as success, so
concurrent runs and a running `.exe` on Windows are safe. A copy whose hash differs is deleted and refused. Only the
copy ever runs, never the file it came from."""

import hashlib
import os
import secrets
from collections.abc import Callable
from typing import Final

from seampact.ir.binary.cache_safety import CacheSafety, unsafe_cache_path
from seampact.ir.binary.download import BinaryDownload
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.installed_binary import InstalledBinary, hash_mismatch
from seampact.ir.https.printable_url import printable_url

_CHUNK_BYTES: Final = 64 * 1024
_EXECUTABLE_BY_OWNER: Final = 0o700
# The copy is made executable only once its hash matches the pin.
_PRIVATE_TO_OWNER: Final = 0o600
_TEMPORARY_SUFFIX_BYTES: Final = 8


def install_binary(source: str, sha256: str, cache_root: str, file_name: str, safety: CacheSafety) -> InstalledBinary:
    """Raises `BinaryRefusedError`."""
    source_sha256 = _source_sha256(source)

    if source_sha256 != sha256:
        raise hash_mismatch(source, sha256, source_sha256)

    return _install_into(
        source, sha256, cache_root, file_name, safety, lambda temporary: _copy_hashing(source, temporary)
    )


def install_downloaded_binary(
    url: str, sha256: str, cache_root: str, file_name: str, safety: CacheSafety, download: BinaryDownload
) -> InstalledBinary:
    """Downloads `url` into the cache unless an intact entry of `sha256` is already there. Raises
    `BinaryRefusedError`."""
    download.refuse_unless_https(url)

    return _install_into(
        printable_url(url),
        sha256,
        cache_root,
        file_name,
        safety,
        lambda temporary: _download_hashing(url, temporary, download),
    )


def _install_into(
    origin: str,
    sha256: str,
    cache_root: str,
    file_name: str,
    safety: CacheSafety,
    write_hashing: Callable[[str], str],
) -> InstalledBinary:
    """`origin` is the source path or the printable URL, for messages; `write_hashing` writes the binary into the new
    temporary file it is given and returns its hash."""
    safety.create_private_directory(cache_root)
    real_cache_root = _real_cache_root(cache_root)
    directory = os.path.join(real_cache_root, sha256)
    safety.create_private_directory(directory)
    safety.refuse_unsafe(directory, real_cache_root)

    target = os.path.join(directory, file_name)
    installed = InstalledBinary(target, sha256, real_cache_root, safety)

    if os.path.isfile(target) and _file_sha256(target) == sha256:
        installed.refuse_unless_intact()

        return installed

    temporary = os.path.join(directory, f".{file_name}.{secrets.token_hex(_TEMPORARY_SUFFIX_BYTES)}.tmp")
    actual = write_hashing(temporary)

    if actual != sha256:
        os.unlink(temporary)

        raise hash_mismatch(origin, sha256, actual)

    try:
        os.chmod(temporary, _EXECUTABLE_BY_OWNER)
        _rename(temporary, target, sha256)
    except OSError as error:
        _remove_quietly(temporary)

        raise unsafe_cache_path(
            temporary,
            f"cannot be made executable or renamed to '{target}' ({error})",
            f"Check that your user can write '{directory}'.",
        ) from error

    installed.refuse_unless_intact()

    return installed


def _real_cache_root(cache_root: str) -> str:
    try:
        return os.path.realpath(cache_root, strict=True)
    except OSError as error:
        raise BinaryRefusedError(
            BinaryFailureCode.CACHE_UNSAFE,
            f"The binary cache root '{cache_root}' cannot be resolved to its real path ({error}).",
            "Check that your user can read the cache directory and each of its parents.",
        ) from error


def _source_sha256(source: str) -> str:
    """The source is hashed before any cache lookup, so a warm cache never hides a source that changed."""
    try:
        return _file_sha256(source)
    except OSError as error:
        raise _unreadable_source(source, error) from error


def _file_sha256(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def _unreadable_source(source: str, error: OSError) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.PIN_INVALID,
        f"The binary source '{source}' is not a readable file ({error}).",
        "Point `[tool.seampact.binary] path` at your build of the compiler.",
    )


def _copy_hashing(source: str, temporary: str) -> str:
    """The SHA-256 of the bytes streamed from `source` into the new file `temporary`."""
    digest = hashlib.sha256()

    try:
        with open(source, "rb") as input_file:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _PRIVATE_TO_OWNER)

            with os.fdopen(descriptor, "wb") as output_file:
                while chunk := input_file.read(_CHUNK_BYTES):
                    output_file.write(chunk)
                    digest.update(chunk)
    except OSError as error:
        _remove_quietly(temporary)

        raise unsafe_cache_path(
            temporary,
            f"cannot be written from '{source}' ({error})",
            "Check the free space and permissions of the binary cache.",
        ) from error

    return digest.hexdigest()


def _download_hashing(url: str, temporary: str, download: BinaryDownload) -> str:
    """The SHA-256 of the bytes downloaded from `url` into the new file `temporary`, which a failed download removes."""
    digest = hashlib.sha256()

    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _PRIVATE_TO_OWNER)

        with os.fdopen(descriptor, "wb") as output_file:

            def write_chunk(chunk: bytes) -> None:
                output_file.write(chunk)
                digest.update(chunk)

            download.stream(url, write_chunk)
    except BinaryRefusedError:
        _remove_quietly(temporary)

        raise
    except OSError as error:
        _remove_quietly(temporary)

        raise unsafe_cache_path(
            temporary,
            f"cannot be written from the download ({error})",
            "Check the free space and permissions of the binary cache.",
        ) from error

    return digest.hexdigest()


def _rename(temporary: str, target: str, sha256: str) -> None:
    """A failed rename over an entry another run installed with the right hash counts as success."""
    try:
        os.replace(temporary, target)
    except OSError:
        if not (os.path.isfile(target) and _file_sha256(target) == sha256):
            raise

        os.unlink(temporary)


def _remove_quietly(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        # Nothing was created, or another cleanup removed it: the refusal being raised is the news.
        return

"""The cache checks run on the private copy of the binary before each start (`binary.cache-unsafe`)."""

from typing import Protocol

from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError


class CacheSafety(Protocol):
    def create_private_directory(self, directory: str) -> None:
        """Creates the cache root, each missing directory on its way and `directory` owner-only, whatever the
        umask."""
        ...

    def refuse_unsafe(self, copy_path: str, cache_root: str) -> None:
        """`cache_root` is the real path of the cache root, which `copy_path` is below. Raises `binary.cache-unsafe`,
        naming the path."""
        ...


def unsafe_cache_path(path: str, problem: str, fix: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.CACHE_UNSAFE,
        f"The binary cache path '{path}' {problem}; seampact runs only a binary no other user can change.",
        fix,
    )

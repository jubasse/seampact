"""The regular files of a bundle, by POSIX path: their sizes up front, their bytes on request."""

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BundleFiles:
    """`sizes` lists every file in discovery order; `read` returns the bytes of one of them."""

    sizes: dict[str, int]
    read: Callable[[str], bytes]

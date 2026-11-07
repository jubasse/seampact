"""Every regular file under a bundle directory with its size, by POSIX path, without following links: a link or a
special file, or a bundle over the caps, is the failure."""

import os
import stat
from pathlib import Path

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.files import BundleFiles
from seampact.ir.bundle.layout import ENTRIES_MAX, EXTRACTED_BYTES_MAX, NOT_A_BUNDLE_FIX, REFETCH_FIX
from seampact.ir.https.untrusted_text import quoted


def read_bundle_directory(directory: Path) -> BundleFiles | BundleFailure:
    sizes: dict[str, int] = {}
    total = 0
    pending = [""]

    while pending:
        relative = pending.pop()
        names = sorted(os.listdir(directory / relative) if relative else os.listdir(directory))

        for name in names:
            path = f"{relative}/{name}" if relative else name
            status = os.lstat(directory / path)

            if stat.S_ISDIR(status.st_mode):
                pending.append(path)
            elif not stat.S_ISREG(status.st_mode):
                return _not_regular(path)
            else:
                sizes[path] = status.st_size
                total += status.st_size

                if len(sizes) > ENTRIES_MAX or total > EXTRACTED_BYTES_MAX:
                    return _over_cap(len(sizes), total)

    return BundleFiles(sizes, lambda path: (directory / path).read_bytes())


def _not_regular(path: str) -> BundleFailure:
    return BundleFailure(
        BundleFailureCode.FILE_TYPE,
        f"{quoted(path)} is a link or a special file; a bundle holds regular files only.",
        REFETCH_FIX,
        path,
    )


def _over_cap(file_count: int, total: int) -> BundleFailure:
    if file_count > ENTRIES_MAX:
        return BundleFailure(
            BundleFailureCode.TOO_MANY_FILES,
            f"The bundle holds more than {ENTRIES_MAX} files.",
            NOT_A_BUNDLE_FIX,
            expected=str(ENTRIES_MAX),
        )

    return BundleFailure(
        BundleFailureCode.TOO_LARGE,
        f"The bundle's files hold more than {EXTRACTED_BYTES_MAX} bytes ({total} so far).",
        NOT_A_BUNDLE_FIX,
        expected=str(EXTRACTED_BYTES_MAX),
    )

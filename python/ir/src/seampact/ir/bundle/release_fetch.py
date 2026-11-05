"""The release-asset channel, as `fetch-release.ts`: the bundle tarball downloaded over HTTPS by `HttpsDownload`, which
stops at the archive cap; the archive reader then checks the bytes. A `ca_file` replaces the system's certificate
authorities."""

from typing import Final

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.layout import ARCHIVE_BYTES_MAX, NOT_A_BUNDLE_FIX
from seampact.ir.bundle.source import ReleaseSource
from seampact.ir.https import HttpsDownload, is_https_url
from seampact.ir.https.printable_url import printable_url
from seampact.ir.https.untrusted_text import quoted

DEADLINE_SECONDS: Final = 60.0
_RELEASE_FIX: Final = "Check the release URL and that the asset is reachable over HTTPS, then run again."


def release_source_problem(source: ReleaseSource) -> BundleFailure | None:
    """Why the source's URL cannot be downloaded from, before any request or cache read."""
    if is_https_url(source.url):
        return None

    return BundleFailure(
        BundleFailureCode.RELEASE_URL,
        f"The release URL {quoted(printable_url(source.url))} is not an absolute https: URL.",
        "Name the bundle tarball by its https: URL.",
    )


class ReleaseFetch:
    def __init__(self, deadline_seconds: float = DEADLINE_SECONDS, ca_file: str | None = None) -> None:
        self._download = HttpsDownload(deadline_seconds, ca_file)

    def download(self, source: ReleaseSource) -> bytes | BundleFailure:
        """The tarball bytes the source's URL serves, or why they could not be fetched."""
        problem = release_source_problem(source)

        if problem is not None:
            return problem

        body = bytearray()
        failure = self._download.stream(source.url, ARCHIVE_BYTES_MAX, body.extend)

        if failure is None:
            return bytes(body)

        if failure.bytes_received_over_cap is not None:
            return BundleFailure(
                BundleFailureCode.ARCHIVE_TOO_LARGE,
                f"The release tarball holds more than {ARCHIVE_BYTES_MAX} bytes ({failure.bytes_received_over_cap} "
                "received), over the cap.",
                NOT_A_BUNDLE_FIX,
                expected=str(ARCHIVE_BYTES_MAX),
            )

        return BundleFailure(
            BundleFailureCode.RELEASE_FAILED,
            f"Downloading the bundle from {quoted(printable_url(failure.url))} {failure.reason}.",
            _RELEASE_FIX,
        )

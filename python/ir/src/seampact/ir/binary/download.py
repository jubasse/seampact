"""Where the compiler binary is downloaded from, and how (ADR 0010, "Fetch"): a release asset of the seampact GitHub
releases, or a mirror base URL to which `/<asset>` is appended. The download is `HttpsDownload`'s, with the system's
certificate authorities and no proxy, as the bundle channel's, a deadline sized for a binary of about 100 MB on a slow
link, and a cap well above any release asset."""

from collections.abc import Callable
from typing import Final
from urllib.parse import quote

from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.bundle.printable_url import printable_url
from seampact.ir.https import HttpsDownload, is_https_url

RELEASE_BASE_URL: Final = "https://github.com/jubasse/seampact/releases/download"
DEADLINE_SECONDS: Final = 600.0
BYTES_MAX: Final = 512 * 1024 * 1024

_FETCH_FIX: Final = (
    "Check that the URL serves the release asset over HTTPS, or set [tool.seampact.binary] in your root "
    "pyproject.toml to a mirror `url` or a `path`, with their hashes."
)


class BinaryDownload:
    def __init__(
        self,
        release_base_url: str = RELEASE_BASE_URL,
        deadline_seconds: float = DEADLINE_SECONDS,
        ca_file: str | None = None,
    ) -> None:
        """`ca_file` replaces the system's certificate authorities; tests serve the assets themselves."""
        self._release_base_url = release_base_url
        self._https = HttpsDownload(deadline_seconds, ca_file)

    def release_url(self, version: str, asset: str) -> str:
        """The URL of `asset` in the release of `version`, tagged `v<version>`."""
        return f"{self._release_base_url}/v{quote(version, safe='')}/{asset}"

    @staticmethod
    def mirror_url(base_url: str, asset: str) -> str:
        return f"{base_url.rstrip('/')}/{asset}"

    @staticmethod
    def refuse_unless_https(url: str) -> None:
        """Refuses a URL that is not `https:` before the cache is touched. Raises `binary.fetch-failed`."""
        if not is_https_url(url):
            raise _fetch_failed(url, "was not tried: it is not an absolute https: URL")

    def stream(self, url: str, sink: Callable[[bytes], None]) -> None:
        """Streams the asset at `url` into `sink`. Raises `binary.fetch-failed`, or what the sink raises."""
        failure = self._https.stream(url, BYTES_MAX, sink)

        if failure is not None:
            raise _fetch_failed(failure.url, failure.reason)


def _fetch_failed(url: str, reason: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.FETCH_FAILED,
        f"Downloading the compiler binary from '{printable_url(url)}' {reason}; nothing is installed.",
        _FETCH_FIX,
    )

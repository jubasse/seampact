"""The release-asset channel, as `fetch-release.ts`: the bundle tarball downloaded over HTTPS. A bundle comes from the
network, so the URL and every redirect must be `https:`, TLS is always verified, redirects are bounded and followed by
hand, each checked, the download has one deadline for every request and body, and it stops at the archive cap; the
archive reader then checks the bytes. A `ca_file` replaces the system's certificate authorities."""

import http.client
import ssl
import time
from typing import Final
from urllib.parse import urljoin, urlsplit

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.layout import ARCHIVE_BYTES_MAX, NOT_A_BUNDLE_FIX
from seampact.ir.bundle.printable_url import printable_url
from seampact.ir.bundle.source import ReleaseSource
from seampact.ir.bundle.text import quoted

DEADLINE_SECONDS: Final = 60.0
_REDIRECTS_MAX: Final = 5
_HTTP_OK: Final = 200
_REDIRECT_STATUSES: Final = (301, 302, 303, 307, 308)
_CHUNK_BYTES: Final = 64 * 1024
_RELEASE_FIX: Final = "Check the release URL and that the asset is reachable over HTTPS, then run again."


def release_source_problem(source: ReleaseSource) -> BundleFailure | None:
    """Why the source's URL cannot be downloaded from, before any request or cache read."""
    if _is_https_url(source.url):
        return None

    return BundleFailure(
        BundleFailureCode.RELEASE_URL,
        f"The release URL {quoted(printable_url(source.url))} is not an absolute https: URL.",
        "Name the bundle tarball by its https: URL.",
    )


class ReleaseFetch:
    def __init__(self, deadline_seconds: float = DEADLINE_SECONDS, ca_file: str | None = None) -> None:
        self._deadline_seconds = deadline_seconds
        self._ca_file = ca_file

    def download(self, source: ReleaseSource) -> bytes | BundleFailure:
        """The tarball bytes the source's URL serves, or why they could not be fetched."""
        problem = release_source_problem(source)

        if problem is not None:
            return problem

        deadline = time.monotonic() + self._deadline_seconds
        url = source.url

        for redirects in range(_REDIRECTS_MAX + 1):
            answer = self._get(url, deadline)

            if isinstance(answer, BundleFailure):
                return answer

            status, location, body = answer

            if body is not None:
                return body

            if status not in _REDIRECT_STATUSES or location is None:
                return self._failed(url, f"answered HTTP {status}")

            if redirects == _REDIRECTS_MAX:
                return self._failed(url, f"redirected more than {_REDIRECTS_MAX} times")

            target = urljoin(url, location)

            if not _is_https_url(target):
                return self._failed(url, f"redirected to {quoted(printable_url(location))}, which is not an https: URL")

            url = target

        raise AssertionError("seampact-ir: the redirect loop ends by return.")

    def _get(self, url: str, deadline: float) -> tuple[int, str | None, bytes | None] | BundleFailure:
        """The status, the location, and a 200's body."""
        remaining = deadline - time.monotonic()

        if remaining <= 0:
            return self._took_too_long(url)

        parts = urlsplit(url)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        context = ssl.create_default_context(cafile=self._ca_file)
        connection = http.client.HTTPSConnection(parts.hostname or "", parts.port, timeout=remaining, context=context)

        try:
            connection.request("GET", target, headers={"Accept-Encoding": "identity", "User-Agent": "seampact-ir"})
            response = connection.getresponse()

            if response.status != _HTTP_OK:
                return response.status, response.getheader("Location"), None

            return response.status, None, self._capped_body(response, connection, url, deadline)
        except _TooLargeError as error:
            return archive_too_large(error.received)
        except (OSError, http.client.HTTPException) as error:
            if time.monotonic() >= deadline:
                return self._took_too_long(url)

            return self._failed(url, f"failed: {_without_url(str(error) or type(error).__name__, url)}")
        finally:
            connection.close()

    def _capped_body(
        self, response: http.client.HTTPResponse, connection: http.client.HTTPSConnection, url: str, deadline: float
    ) -> bytes:
        body = bytearray()

        while True:
            remaining = deadline - time.monotonic()

            if remaining <= 0:
                raise TimeoutError

            if connection.sock is not None:
                connection.sock.settimeout(remaining)

            chunk = response.read(_CHUNK_BYTES)

            if not chunk:
                return bytes(body)

            body += chunk

            if len(body) > ARCHIVE_BYTES_MAX:
                raise _TooLargeError(len(body))

    def _took_too_long(self, url: str) -> BundleFailure:
        return self._failed(url, f"took over {round(self._deadline_seconds * 1000)} ms")

    @staticmethod
    def _failed(url: str, what: str) -> BundleFailure:
        return BundleFailure(
            BundleFailureCode.RELEASE_FAILED,
            f"Downloading the bundle from {quoted(printable_url(url))} {what}.",
            _RELEASE_FIX,
        )


class _TooLargeError(OSError):
    def __init__(self, received: int) -> None:
        super().__init__(f"more than {ARCHIVE_BYTES_MAX} bytes ({received} received)")
        self.received = received


def archive_too_large(received: int) -> BundleFailure:
    return BundleFailure(
        BundleFailureCode.ARCHIVE_TOO_LARGE,
        f"The release tarball holds more than {ARCHIVE_BYTES_MAX} bytes ({received} received), over the cap.",
        NOT_A_BUNDLE_FIX,
        expected=str(ARCHIVE_BYTES_MAX),
    )


def _is_https_url(url: str) -> bool:
    try:
        parts = urlsplit(url)

        return parts.scheme.lower() == "https" and bool(parts.hostname)
    except ValueError:
        return False


def _without_url(reason: str, url: str) -> str:
    """Error texts may repeat the URL, which may hold a token; the printable form replaces it."""
    return reason.replace(url, printable_url(url))

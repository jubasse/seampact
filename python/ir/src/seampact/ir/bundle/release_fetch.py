"""The release-asset channel, as `fetch-release.ts`: the bundle tarball downloaded over HTTPS. A bundle comes from the
network, so the URL and every redirect must be `https:`, TLS is always verified, redirects are bounded and followed by
hand, each checked, the download has one deadline for every request and body, and it stops at the archive cap; the
archive reader then checks the bytes. A `ca_file` replaces the system's certificate authorities."""

import contextlib
import http.client
import socket
import ssl
import threading
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
_WATCHDOG_POLL_SECONDS: Final = 0.05
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


class _WatchedConnection(http.client.HTTPSConnection):
    """Keeps the connected socket after the response drops `sock` (a response that closes the connection does it as
    soon as its headers are read), so the watchdog can still shut it down while the body is read."""

    connected_socket: socket.socket | None = None

    def connect(self) -> None:
        super().connect()
        self.connected_socket = self.sock


class _Watchdog:
    """Shuts the connection's socket down once the deadline passes, so a server that sends a byte now and then cannot
    hold a read (or the handshake or the headers) past it: a socket timeout bounds each `recv`, not the request."""

    def __init__(self, connection: _WatchedConnection, deadline: float) -> None:
        self.fired = False
        self._connection = connection
        self._deadline = deadline
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._watch, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()
        self._thread.join()

    def _watch(self) -> None:
        while not self._stopped.wait(_WATCHDOG_POLL_SECONDS):
            if time.monotonic() < self._deadline:
                continue

            self.fired = True

            if self._shut_down_socket():
                return

    def _shut_down_socket(self) -> bool:
        """Whether the socket is down; false while the connection has none yet."""
        sock = self._connection.connected_socket

        if sock is None:
            return False

        # The base method: an `SSLSocket`'s own `shutdown` unwraps the TLS object another thread is reading.
        with contextlib.suppress(OSError):
            socket.socket.shutdown(sock, socket.SHUT_RDWR)

        return True


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
        connection = _WatchedConnection(parts.hostname or "", parts.port, timeout=remaining, context=context)

        watchdog = _Watchdog(connection, deadline)

        try:
            connection.request("GET", target, headers={"Accept-Encoding": "identity", "User-Agent": "seampact-ir"})
            response = connection.getresponse()

            if response.status != _HTTP_OK:
                return response.status, response.getheader("Location"), None

            body = self._capped_body(response, connection, deadline)

            if watchdog.fired:
                return self._took_too_long(url)

            return response.status, None, body
        except _TooLargeError as error:
            return archive_too_large(error.received)
        except (OSError, http.client.HTTPException) as error:
            if watchdog.fired or time.monotonic() >= deadline:
                return self._took_too_long(url)

            return self._failed(url, f"failed: {_without_url(str(error) or type(error).__name__, url)}")
        finally:
            watchdog.stop()
            connection.close()

    def _capped_body(
        self, response: http.client.HTTPResponse, connection: _WatchedConnection, deadline: float
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
        # `port` raises for one out of range or not a number.
        _ = parts.port

        return parts.scheme.lower() == "https" and bool(parts.hostname)
    except ValueError:
        return False


def _without_url(reason: str, url: str) -> str:
    """Error texts may repeat the URL, which may hold a token; the printable form replaces it."""
    return reason.replace(url, printable_url(url))

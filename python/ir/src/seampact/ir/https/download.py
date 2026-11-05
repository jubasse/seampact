"""A download over HTTPS, streamed chunk by chunk to a sink. The URL and every redirect must be `https:`, TLS is always
verified, redirects are bounded and followed by hand, each checked, one deadline covers every request and body, and the
body stops at a byte cap. A `ca_file` replaces the system's certificate authorities."""

import contextlib
import http.client
import re
import socket
import ssl
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final
from urllib.parse import urljoin, urlsplit

from seampact.ir.https.printable_url import printable_url
from seampact.ir.https.untrusted_text import quoted

_REDIRECTS_MAX: Final = 5
_HTTP_OK: Final = 200
_REDIRECT_STATUSES: Final = (301, 302, 303, 307, 308)
_CHUNK_BYTES: Final = 64 * 1024
_WATCHDOG_POLL_SECONDS: Final = 0.05
# What `http.client` refuses in a request target; `urlsplit` drops tab and newline silently, so the raw text is checked.
_CONTROL_OR_SPACE: Final = re.compile(r"[\x00-\x20\x7f]")
_HOLDS_CONTROL_OR_SPACE: Final = "holds a control character or a space"


@dataclass(frozen=True, slots=True)
class HttpsFailure:
    """Why a download stopped: the URL that failed (after redirects), what happened to it, and, for a body over the
    cap, the bytes received so far. The URL is raw: each channel prints it without its userinfo and query."""

    url: str
    reason: str
    bytes_received_over_cap: int | None = None


class _SinkError(Exception):
    """What the sink raised, carried past the network `except` so it reaches the caller unchanged."""

    def __init__(self, error: Exception) -> None:
        super().__init__(error)
        self.error = error


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


class HttpsDownload:
    def __init__(self, deadline_seconds: float, ca_file: str | None = None) -> None:
        self._deadline_seconds = deadline_seconds
        self._ca_file = ca_file

    def stream(self, url: str, bytes_max: int, sink: Callable[[bytes], None]) -> HttpsFailure | None:
        """Streams the body `url` answers into `sink`, or says why it stopped; the sink may have received part of it.
        What the sink raises propagates."""
        untried = untried_reason(url)

        if untried is not None:
            return HttpsFailure(url, f"was not tried: {untried}")

        deadline = time.monotonic() + self._deadline_seconds

        for redirects in range(_REDIRECTS_MAX + 1):
            try:
                answer = self._get(url, deadline, bytes_max, sink)
            except _SinkError as wrapped:
                raise wrapped.error from None

            if not isinstance(answer, tuple):
                return answer

            status, location = answer

            if status not in _REDIRECT_STATUSES or location is None:
                return HttpsFailure(url, f"answered HTTP {status}")

            if redirects == _REDIRECTS_MAX:
                return HttpsFailure(url, f"redirected more than {_REDIRECTS_MAX} times")

            target = urljoin(url, location)

            if _CONTROL_OR_SPACE.search(location) is not None:
                return HttpsFailure(
                    url, f"redirected to {quoted(printable_url(location))}, which {_HOLDS_CONTROL_OR_SPACE}"
                )

            if not is_https_url(target):
                return HttpsFailure(url, f"redirected to {quoted(printable_url(location))}, which is not an https: URL")

            url = target

        raise AssertionError("seampact-ir: the redirect loop ends by return.")

    def _get(
        self, url: str, deadline: float, bytes_max: int, sink: Callable[[bytes], None]
    ) -> tuple[int, str | None] | HttpsFailure | None:
        """None once a 200's body is streamed, else the status and `Location` of the answer, or the failure."""
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
                return response.status, response.getheader("Location")

            failure = self._capped_body(response, connection, url, deadline, bytes_max, sink)

            if watchdog.fired:
                return self._took_too_long(url)

            return failure
        except (OSError, http.client.HTTPException) as error:
            if watchdog.fired or time.monotonic() >= deadline:
                return self._took_too_long(url)

            return HttpsFailure(url, f"failed: {_without_url(str(error) or type(error).__name__, url)}")
        finally:
            watchdog.stop()
            connection.close()

    @staticmethod
    def _capped_body(
        response: http.client.HTTPResponse,
        connection: _WatchedConnection,
        url: str,
        deadline: float,
        bytes_max: int,
        sink: Callable[[bytes], None],
    ) -> HttpsFailure | None:
        received = 0
        # `read(amt)` returns what came before the connection closed, so a body cut short is told by its length.
        expected = response.length

        while True:
            remaining = deadline - time.monotonic()

            if remaining <= 0:
                raise TimeoutError

            if connection.sock is not None:
                connection.sock.settimeout(remaining)

            try:
                chunk = response.read(_CHUNK_BYTES)
            except http.client.IncompleteRead as cut:
                return _ended_early(url, received + len(cut.partial), expected)

            if not chunk:
                return _ended_early(url, received, expected) if expected is not None and received < expected else None

            received += len(chunk)

            if received > bytes_max:
                return HttpsFailure(
                    url, f"sent more than {bytes_max} bytes ({received} received), over the cap", received
                )

            try:
                sink(chunk)
            except Exception as error:
                raise _SinkError(error) from error

    def _took_too_long(self, url: str) -> HttpsFailure:
        return HttpsFailure(url, f"took over {round(self._deadline_seconds * 1000)} ms")


def untried_reason(url: str) -> str | None:
    """Why `url` is not requested at all, or `None` when it may be."""
    if _CONTROL_OR_SPACE.search(url) is not None:
        return f"it {_HOLDS_CONTROL_OR_SPACE}"

    return None if is_https_url(url) else "it is not an absolute https: URL"


def is_https_url(url: str) -> bool:
    if _CONTROL_OR_SPACE.search(url) is not None:
        return False

    try:
        parts = urlsplit(url)
        # `port` raises for one out of range or not a number.
        _ = parts.port

        return parts.scheme.lower() == "https" and bool(parts.hostname)
    except ValueError:
        return False


def _ended_early(url: str, received: int, expected: int | None) -> HttpsFailure:
    promised = "" if expected is None else f" of {expected}"

    return HttpsFailure(url, f"ended after {received}{promised} bytes")


def _without_url(reason: str, url: str) -> str:
    """Error texts may repeat the URL, which may hold a token; the printable form replaces it."""
    return reason.replace(url, printable_url(url))

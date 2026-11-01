"""The release channel over a local TLS server with its certificate verified, and the integrity-keyed cache."""

import http.server
import ssl
import subprocess
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from seampact.ir.bundle import BundleFailure, BundleFailureCode
from seampact.ir.bundle.fetched import FetchedBundle
from seampact.ir.bundle.fetcher import BundleFetcher
from seampact.ir.bundle.git_fetch import GitFetch
from seampact.ir.bundle.release_fetch import ReleaseFetch
from seampact.ir.bundle.source import ReleaseSource
from seampact.ir.config.local_source_policy import LocalSourcePolicy

_SLOW_SECONDS = 2.0
_TRICKLE_BYTES_SENT = 50
_TRICKLE_BYTES_PROMISED = 100_000
_TRICKLE_PAUSE_SECONDS = 0.1
_TRICKLE_DEADLINE_SECONDS = 0.5
_TRICKLE_STOP_WITHIN_SECONDS = 3.0


class _TlsServer:
    def __init__(self, directory: Path, tarball: bytes) -> None:
        self.certificate = directory / "server.pem"
        self.requests: list[str] = []
        self.tarball = tarball
        self._make_certificate(directory)
        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                server.requests.append(self.path)
                self._answer()

            def log_message(self, format: str, *args: object) -> None:
                return

            def _answer(self) -> None:
                if self.path == "/bundle.tgz":
                    self._send(200, server.tarball)
                elif self.path == "/redirect":
                    self._redirect("/bundle.tgz")
                elif self.path == "/loop":
                    self._redirect("/loop")
                elif self.path == "/downgrade":
                    self._redirect("http://127.0.0.1/bundle.tgz")
                elif self.path == "/slow":
                    time.sleep(_SLOW_SECONDS)
                    self._send(200, server.tarball)
                elif self.path == "/trickle":
                    self._trickle()
                elif self.path == "/bad-port":
                    self._redirect("https://127.0.0.1:99999/bundle.tgz")
                else:
                    self._send(404, b"no")

            def _trickle(self) -> None:
                self.send_response(200)
                self.send_header("Content-Length", str(_TRICKLE_BYTES_PROMISED))
                self.end_headers()

                try:
                    for _ in range(_TRICKLE_BYTES_SENT):
                        self.wfile.write(b"x")
                        self.wfile.flush()
                        time.sleep(_TRICKLE_PAUSE_SECONDS)
                except OSError:
                    return

            def _redirect(self, location: str) -> None:
                self.send_response(302)
                self.send_header("Location", location)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def _send(self, status: int, body: bytes) -> None:
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.certificate)
        self._httpd.socket = context.wrap_socket(self._httpd.socket, server_side=True)
        self.port = self._httpd.server_address[1]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def url(self, path: str) -> str:
        return f"https://127.0.0.1:{self.port}{path}"

    def stop(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()

    def _make_certificate(self, directory: Path) -> None:
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
                "-keyout", str(self.certificate), "-out", str(self.certificate), "-days", "1",
                "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
            ],
            check=True,
            capture_output=True,
            cwd=directory,
        )  # fmt: skip


@pytest.fixture
def server(tmp_path: Path, valid_bundle_tarball: bytes) -> Iterator[_TlsServer]:
    tls = _TlsServer(tmp_path, valid_bundle_tarball)
    yield tls
    tls.stop()


def _fetcher(cache: Path, server: _TlsServer | None, deadline: float = 10.0) -> BundleFetcher:
    ca_file = None if server is None else str(server.certificate)

    return BundleFetcher(str(cache), ReleaseFetch(deadline, ca_file), GitFetch({}))


def _failure_codes(result: FetchedBundle | list[BundleFailure]) -> list[BundleFailureCode]:
    assert isinstance(result, list)

    return [failure.code for failure in result]


def test_a_release_is_downloaded_checked_and_cached_by_integrity(
    server: _TlsServer, tmp_path: Path, valid_bundle: tuple[dict[str, bytes], str]
) -> None:
    _, pin = valid_bundle
    fetcher = _fetcher(tmp_path / "cache", server)
    source = ReleaseSource(server.url("/bundle.tgz"), pin)

    first = fetcher.fetch(source, str(tmp_path), LocalSourcePolicy.ALLOW)
    second = fetcher.fetch(source, str(tmp_path), LocalSourcePolicy.ALLOW)

    assert isinstance(first, FetchedBundle)
    assert first.integrity == pin
    assert second == first
    assert server.requests == ["/bundle.tgz"]


def test_a_missing_pin_fails_and_prints_the_value_to_pin(server: _TlsServer, tmp_path: Path) -> None:
    result = _fetcher(tmp_path / "cache", server).fetch(
        ReleaseSource(server.url("/bundle.tgz"), None), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert isinstance(result, list)
    assert result[0].code is BundleFailureCode.PIN_MISSING
    assert (result[0].actual or "").startswith("sha256-")


def test_a_different_pin_is_refused_and_nothing_is_cached(server: _TlsServer, tmp_path: Path) -> None:
    other = "sha256-" + "A" * 43 + "="
    result = _fetcher(tmp_path / "cache", server).fetch(
        ReleaseSource(server.url("/bundle.tgz"), other), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert _failure_codes(result) == [BundleFailureCode.PIN_MISMATCH]
    assert not (tmp_path / "cache" / "bundles").exists()


def test_a_redirect_is_followed(server: _TlsServer, tmp_path: Path, valid_bundle: tuple[dict[str, bytes], str]) -> None:
    result = _fetcher(tmp_path / "cache", server).fetch(
        ReleaseSource(server.url("/redirect"), valid_bundle[1]), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert isinstance(result, FetchedBundle)


@pytest.mark.parametrize("path", ["/loop", "/downgrade", "/missing"])
def test_a_redirect_loop_a_downgrade_and_an_error_status_are_refused(
    server: _TlsServer, tmp_path: Path, path: str
) -> None:
    result = _fetcher(tmp_path / "cache", server).fetch(
        ReleaseSource(server.url(path), None), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert _failure_codes(result) == [BundleFailureCode.RELEASE_FAILED]


def test_a_certificate_the_system_does_not_trust_is_refused(server: _TlsServer, tmp_path: Path) -> None:
    result = _fetcher(tmp_path / "cache", None).fetch(
        ReleaseSource(server.url("/bundle.tgz"), None), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert _failure_codes(result) == [BundleFailureCode.RELEASE_FAILED]
    assert server.requests == []


def test_a_url_that_is_not_https_is_refused_before_any_request(tmp_path: Path) -> None:
    result = _fetcher(tmp_path / "cache", None).fetch(
        ReleaseSource("http://127.0.0.1/bundle.tgz", None), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert _failure_codes(result) == [BundleFailureCode.RELEASE_URL]


def test_a_download_past_the_deadline_is_refused(server: _TlsServer, tmp_path: Path) -> None:
    result = _fetcher(tmp_path / "cache", server, deadline=0.3).fetch(
        ReleaseSource(server.url("/slow"), None), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert isinstance(result, list)
    assert result[0].code is BundleFailureCode.RELEASE_FAILED
    assert "took over" in result[0].message


def test_a_body_trickling_past_the_deadline_stops_at_the_deadline(server: _TlsServer, tmp_path: Path) -> None:
    started = time.monotonic()

    result = _fetcher(tmp_path / "cache", server, deadline=_TRICKLE_DEADLINE_SECONDS).fetch(
        ReleaseSource(server.url("/trickle"), None), str(tmp_path), LocalSourcePolicy.ALLOW
    )

    assert time.monotonic() - started < _TRICKLE_STOP_WITHIN_SECONDS
    assert isinstance(result, list)
    assert [failure.code for failure in result] == [BundleFailureCode.RELEASE_FAILED]
    assert "took over" in result[0].message


def test_a_port_out_of_range_is_refused_by_name_in_the_url_and_in_a_redirect(
    server: _TlsServer, tmp_path: Path
) -> None:
    fetcher = _fetcher(tmp_path / "cache", server)

    for url, code in (
        ("https://127.0.0.1:99999/bundle.tgz", BundleFailureCode.RELEASE_URL),
        ("https://127.0.0.1:abc/bundle.tgz", BundleFailureCode.RELEASE_URL),
        (server.url("/bad-port"), BundleFailureCode.RELEASE_FAILED),
    ):
        result = fetcher.fetch(ReleaseSource(url, None), str(tmp_path), LocalSourcePolicy.ALLOW)

        assert _failure_codes(result) == [code], url


def test_a_cache_entry_changed_after_it_was_cached_names_itself(
    server: _TlsServer, tmp_path: Path, valid_bundle: tuple[dict[str, bytes], str]
) -> None:
    _, pin = valid_bundle
    fetcher = _fetcher(tmp_path / "cache", server)
    source = ReleaseSource(server.url("/bundle.tgz"), pin)
    assert isinstance(fetcher.fetch(source, str(tmp_path), LocalSourcePolicy.ALLOW), FetchedBundle)
    entry = next((tmp_path / "cache" / "bundles").iterdir())
    tampered = next(path for path in entry.rglob("*") if path.is_file() and path.name != "seampact-bundle.json")
    tampered.write_bytes(tampered.read_bytes() + b"x")

    result = fetcher.fetch(source, str(tmp_path), LocalSourcePolicy.ALLOW)

    assert _failure_codes(result)[0] is BundleFailureCode.CACHE_INVALID
    assert isinstance(fetcher.verified_cache_entry(pin), BundleFailure)


def test_a_registry_source_is_refused_by_name(tmp_path: Path) -> None:
    from seampact.ir.bundle.source import Registry, RegistrySource

    fetcher = _fetcher(tmp_path / "cache", None)
    npm = fetcher.fetch(RegistrySource(Registry.NPM, "p@1", None), str(tmp_path), LocalSourcePolicy.ALLOW)
    maven = fetcher.fetch(RegistrySource(Registry.MAVEN, "g:a:1", None), str(tmp_path), LocalSourcePolicy.ALLOW)

    assert _failure_codes(npm) == [BundleFailureCode.PACKAGE_UNSUPPORTED]
    assert _failure_codes(maven) == [BundleFailureCode.MAVEN_JVM_ONLY]

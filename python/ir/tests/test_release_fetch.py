"""The release channels over a local TLS server with its certificate verified: the bundle tarball and its
integrity-keyed cache, and the compiler binary a `version` or `url` override downloads, checks and caches."""

import hashlib
import http.server
import os
import ssl
import subprocess
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from seampact.ir.binary import BinaryFailureCode, BinaryRefusedError, HostLibc, HostPlatform, install_compiler_binary
from seampact.ir.binary.download import BinaryDownload
from seampact.ir.binary.posix_cache_safety import PosixCacheSafety
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


_ASSETS_PATH = "/assets/"


class _TlsServer:
    """Serves the bundle routes, and each of `assets` by name under `/assets/`, by the last segment of the path."""

    def __init__(self, directory: Path, tarball: bytes) -> None:
        self.certificate = directory / "server.pem"
        self.requests: list[str] = []
        self.tarball = tarball
        self.assets: dict[str, bytes] = {}
        self._make_certificate(directory)
        server = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                server.requests.append(self.path)
                self._answer()

            def log_message(self, format: str, *args: object) -> None:
                return

            def _answer(self) -> None:
                asset = server.assets.get(self.path.rsplit("/", 1)[-1])

                if self.path.startswith(_ASSETS_PATH) and asset is not None:
                    self._send(200, asset)
                elif self.path == "/bundle.tgz":
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


# The stub binary touches the file its first argument names, so a test sees that it ran.
_STUB = b'#!/bin/sh\ntouch "$1"\n'
_STUB_SHA256 = hashlib.sha256(_STUB).hexdigest()
_OTHER_SHA256 = "0" * 64
_HOST = HostPlatform("linux", "x86_64", HostLibc.GLIBC)
_HOST_ASSET = "seampact-linux-x64"
_RELEASE_ASSETS = (
    "seampact-linux-x64",
    "seampact-linux-arm64",
    "seampact-darwin-x64",
    "seampact-darwin-arm64",
    "seampact-win32-x64.exe",
)

skip_on_windows = pytest.mark.skipif(os.name == "nt", reason="the stub binary is a shell script")


def _binary_override(tmp_path: Path, source: str, host_sha256: str) -> None:
    hashes = "".join(
        f'"{asset}" = "{host_sha256 if asset == _HOST_ASSET else _OTHER_SHA256}"\n' for asset in _RELEASE_ASSETS
    )
    (tmp_path / "pyproject.toml").write_text(
        f"[project]\nname = 'app'\n[tool.seampact.binary]\n{source}\n[tool.seampact.binary.sha256]\n{hashes}",
        encoding="utf-8",
    )


def _install_downloaded(
    tmp_path: Path, server: _TlsServer, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> str:
    # The release URL `<base>/v<version>/<asset>` is served by its last segment.
    download = BinaryDownload(server.url("/assets"), 10.0, str(server.certificate))
    cache = tmp_path / "cache"

    return install_compiler_binary(
        str(tmp_path), _HOST, {"XDG_CACHE_HOME": str(cache)}, trusting_ancestors(cache), download
    ).path


def _download_refusal(
    tmp_path: Path, server: _TlsServer, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> BinaryRefusedError:
    with pytest.raises(BinaryRefusedError) as refused:
        _install_downloaded(tmp_path, server, trusting_ancestors)

    return refused.value


@skip_on_windows
@pytest.mark.parametrize("source", ['version = "1.2.3"', "url = 'MIRROR'"], ids=["version", "mirror url"])
def test_an_override_downloads_the_host_asset_and_runs_it(
    server: _TlsServer, tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety], source: str
) -> None:
    server.assets[_HOST_ASSET] = _STUB
    _binary_override(tmp_path, source.replace("MIRROR", server.url(_ASSETS_PATH)), _STUB_SHA256)

    installed = _install_downloaded(tmp_path, server, trusting_ancestors)
    subprocess.run([installed, str(tmp_path / "started")], check=True)

    assert installed.startswith(str(tmp_path / "cache" / "seampact"))
    assert Path(installed).read_bytes() == _STUB
    assert (tmp_path / "started").exists()
    assert server.requests[-1].endswith(_HOST_ASSET)


@skip_on_windows
def test_a_downloaded_asset_whose_hash_is_not_the_pin_is_refused_and_nothing_installed(
    server: _TlsServer, tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    server.assets[_HOST_ASSET] = _STUB
    _binary_override(tmp_path, 'version = "1.2.3"', _OTHER_SHA256)

    failure = _download_refusal(tmp_path, server, trusting_ancestors).failure

    assert failure.code is BinaryFailureCode.HASH_MISMATCH
    assert _STUB_SHA256 in failure.message
    assert list((tmp_path / "cache" / "seampact" / _OTHER_SHA256).iterdir()) == []


@skip_on_windows
def test_a_missing_asset_is_refused_by_its_url_and_status(
    server: _TlsServer, tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    _binary_override(tmp_path, f"url = '{server.url('/missing?token=secret')}'", _STUB_SHA256)

    failure = _download_refusal(tmp_path, server, trusting_ancestors).failure

    assert failure.code is BinaryFailureCode.FETCH_FAILED
    assert "answered HTTP 404" in failure.message
    assert "secret" not in failure.message
    assert list((tmp_path / "cache" / "seampact" / _STUB_SHA256).iterdir()) == []


@skip_on_windows
def test_an_http_mirror_is_refused_before_the_cache_is_touched(
    server: _TlsServer, tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    _binary_override(tmp_path, "url = 'http://127.0.0.1/assets'", _STUB_SHA256)

    failure = _download_refusal(tmp_path, server, trusting_ancestors).failure

    assert failure.code is BinaryFailureCode.FETCH_FAILED
    assert "not an absolute https: URL" in failure.message
    assert not (tmp_path / "cache").exists()


@skip_on_windows
def test_a_cached_download_is_reused_without_another_request(
    server: _TlsServer, tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    server.assets[_HOST_ASSET] = _STUB
    _binary_override(tmp_path, 'version = "1.2.3"', _STUB_SHA256)

    first = _install_downloaded(tmp_path, server, trusting_ancestors)
    del server.assets[_HOST_ASSET]
    second = _install_downloaded(tmp_path, server, trusting_ancestors)

    assert second == first
    assert len(server.requests) == 1

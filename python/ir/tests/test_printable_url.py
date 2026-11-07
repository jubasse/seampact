"""A URL in a diagnostic carries no user name, password, query or fragment, even when it does not parse."""

import pytest

from seampact.ir.https.printable_url import printable_url


@pytest.mark.parametrize(
    ("written", "printed"),
    [
        ("https://user:SECRET@Host.example:8443/a/b?token=S2#frag", "https://host.example:8443/a/b"),
        ("https://host.example", "https://host.example/"),
        ("git@github.com:owner/repo.git", "git@github.com:owner/repo.git"),
        ("/local/path", "/local/path"),
        ("https://u:SECRET@h:99999/x?t=S2", "https://h:99999/x"),
        ("gopher://u:SECRET@h:99999/r", "gopher://h:99999/r"),
        ("https://u:SECRET@[::1/x#f", "https://[::1/x"),
        ("https://h:abc/x?t=S2", "https://h:abc/x"),
        (" \thttps://u:SECRET@h:99999/x", "https://h:99999/x"),
        ("https:/u:SECRET@h:99999/x", "https:/h:99999/x"),
        ("https:\\\\u:SECRET@h:99999/x", "https:\\\\h:99999/x"),
        ("https:u:SECRET@h:99999/x", "https:h:99999/x"),
        ("https://u:SECRET#?x@h:99999/x?t=S2", "https://h:99999/x"),
        ("https://u:SECRET@", "https://"),
        ("\x01https://u:SECRET@h/x?t=S2", "https://h/x"),
        ("\x00https://u:SECRET@h:99999/x", "https://h:99999/x"),
        ("https://u:SECRET@h/x?t=S2\x1f ", "https://h/x"),
        ("ht\ttps://u:SECRET@h/x?t=S2", "https://h/x"),
        ("https\n://u:SECRET@h/x", "https://h/x"),
        ("h\rttps://u:SECRET@h:99999/x?t=S2", "https://h:99999/x"),
        ("https://u:SECRET@[::1]:8443/x?t=S2", "https://[::1]:8443/x"),
        ("https://u:SECRET@h:443/x?t=S2", "https://h/x"),
        ("http://u:SECRET@h:80/x", "http://h/x"),
        ("gopher://u:SECRET@h:443/x", "gopher://h:443/x"),
    ],
)
def test_a_url_is_printed_without_its_credentials_query_and_fragment(written: str, printed: str) -> None:
    assert printable_url(written) == printed
    assert "SECRET" not in printable_url(written)
    assert "S2" not in printable_url(written)

"""The HTTPS download both release channels share (the bundle tarball and the compiler binary), with the printable URL
and the quoting of untrusted text their messages use."""

from seampact.ir.https.download import HttpsDownload, HttpsFailure, is_https_url, untried_reason

__all__ = ["HttpsDownload", "HttpsFailure", "is_https_url", "untried_reason"]

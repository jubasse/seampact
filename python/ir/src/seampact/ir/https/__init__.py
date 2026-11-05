"""The HTTPS download both release channels share: the bundle tarball and the compiler binary."""

from seampact.ir.https.download import HttpsDownload, HttpsFailure, is_https_url

__all__ = ["HttpsDownload", "HttpsFailure", "is_https_url"]

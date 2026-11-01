"""How a bundle was fetched: an npm package root may also hold npm's own files (`package.json`, `README*`...)."""

from enum import StrEnum


class BundleChannel(StrEnum):
    PACKAGE = "package"
    RELEASE = "release"
    GIT = "git"

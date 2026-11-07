"""The bundle reader and verifier (ADR 0011): reads a tarball or a directory, runs the pinned-bundle check."""

from seampact.ir.bundle.archive import read_bundle_archive
from seampact.ir.bundle.channel import BundleChannel
from seampact.ir.bundle.directory import read_bundle_directory
from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.files import BundleFiles
from seampact.ir.bundle.verification import BundleVerification
from seampact.ir.bundle.verifier import verify_bundle

__all__ = [
    "BundleChannel",
    "BundleFailure",
    "BundleFailureCode",
    "BundleFiles",
    "BundleVerification",
    "read_bundle_archive",
    "read_bundle_directory",
    "verify_bundle",
]

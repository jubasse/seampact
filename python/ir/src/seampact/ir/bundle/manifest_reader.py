"""The manifest as a verifier reads it: at most `MANIFEST_BYTES_MAX` bytes of UTF-8 JSON with no byte order mark, no
reserved key and no key given twice in one object, valid under the manifest schema, then under the rules no schema
states (`manifest_rules`)."""

from typing import Final

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.layout import MANIFEST_BYTES_MAX, MANIFEST_FILE, REBUILD_FIX
from seampact.ir.bundle.manifest import BundleManifest, manifest_of_schema_valid
from seampact.ir.bundle.manifest_rules import manifest_rule_problems
from seampact.ir.bundle.spec_schema import manifest_schema
from seampact.ir.bundle.text import listed_problems
from seampact.ir.bundle.untrusted_json import parse_untrusted_json

# A refusal lists at most this many problems, then how many more there are.
_LISTED_PROBLEM_LIMIT: Final = 5


def read_manifest(data: bytes) -> BundleManifest | BundleFailure:
    """The manifest of `data`, or the failure naming why it is refused."""
    if len(data) > MANIFEST_BYTES_MAX:
        return manifest_too_large(len(data))

    parsed = parse_untrusted_json(data, refuse_duplicate_keys=True)

    if parsed.problem is not None:
        return _invalid([parsed.problem])

    schema_problems = manifest_schema().problems(parsed.document)

    if schema_problems:
        return _invalid(schema_problems)

    manifest = manifest_of_schema_valid(parsed.document)
    rule_problems = manifest_rule_problems(manifest)

    return _invalid(rule_problems) if rule_problems else manifest


def manifest_too_large(size: int) -> BundleFailure:
    """The failure of a manifest over the cap, refused before it is read."""
    return BundleFailure(
        BundleFailureCode.MANIFEST_TOO_LARGE,
        f"'{MANIFEST_FILE}' holds {size} bytes, over the cap of {MANIFEST_BYTES_MAX}.",
        "Check that the source names a seampact bundle; a manifest this large is not one.",
        MANIFEST_FILE,
        str(MANIFEST_BYTES_MAX),
        str(size),
    )


def _invalid(problems: list[str]) -> BundleFailure:
    return BundleFailure(
        BundleFailureCode.MANIFEST_INVALID,
        f"'{MANIFEST_FILE}' is not a valid manifest: {listed_problems(problems, _LISTED_PROBLEM_LIMIT)}.",
        REBUILD_FIX,
        MANIFEST_FILE,
    )

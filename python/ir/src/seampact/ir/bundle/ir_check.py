"""Step 3 of the pinned-bundle check, for one api: the IR file is UTF-8 JSON with no reserved key, declares the
irVersion and irRevision the manifest lists, is of a version this reader reads at its exact irRevision (before 1.0,
ADR 0005), with the lists it reads well-formed, validates against the open IR JSON Schema with no must-act unknown,
then decodes into the IR model. Kinds and features are a target's question (`read_document` with its own support),
not the bundle's."""

from typing import Final

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.manifest import BundleApi
from seampact.ir.bundle.spec_schema import ir_schema
from seampact.ir.bundle.text import listed_problems
from seampact.ir.bundle.untrusted_json import parse_untrusted_json
from seampact.ir.https.untrusted_text import quoted
from seampact.ir.hydration import IrModelError
from seampact.ir.model import ContractIR
from seampact.ir.read.must_act import check_must_act
from seampact.ir.read.refusal import IrRefusalCode, Missing, in_message, shown
from seampact.ir.read.support import IrSupport, check_support

_FIX: Final = "Rebuild the bundle with a compiler of this IR revision, or use the seampact release that reads it."
_LISTED_PROBLEM_LIMIT: Final = 5
_SUPPORT_CODES: Final = {
    IrRefusalCode.VERSION_UNSUPPORTED: BundleFailureCode.IR_VERSION,
    IrRefusalCode.REVISION_MISMATCH: BundleFailureCode.IR_REVISION,
    IrRefusalCode.SUPPORT_MALFORMED: BundleFailureCode.IR_INVALID,
}


def check_api_ir(api: BundleApi, data: bytes) -> ContractIR | BundleFailure:
    """The api's IR, or the failure naming its file and the values that differ."""
    parsed = parse_untrusted_json(data, refuse_duplicate_keys=False)

    if parsed.problem is not None:
        return BundleFailure(BundleFailureCode.IR_UNREADABLE, f"'{api.file}' {parsed.problem}.", _FIX, api.file)

    document = parsed.document
    declared = document if isinstance(document, dict) else {}
    declared_version = declared.get("irVersion", Missing.ABSENT)
    declared_revision = declared.get("irRevision", Missing.ABSENT)

    if not _is_number(declared_version, api.ir_version) or not _is_number(declared_revision, api.ir_revision):
        return BundleFailure(
            BundleFailureCode.IR_DECLARATION,
            f"'{api.file}' declares irVersion {_shown(declared_version)} and irRevision {_shown(declared_revision)}; "
            f"the manifest lists {api.ir_version} and {api.ir_revision}.",
            _FIX,
            api.file,
            f"{api.ir_version}.{api.ir_revision}",
            f"{_plain(declared_version)}.{_plain(declared_revision)}",
        )

    support = _support_failure(api, document)

    if support is not None:
        return support

    problems = [*ir_schema().problems(document), *_must_act_problems(document)]

    if problems:
        return _invalid(api, listed_problems(problems, _LISTED_PROBLEM_LIMIT))

    try:
        return ContractIR.from_json(document)
    except IrModelError as error:
        return _invalid(api, quoted(str(error)))


def _invalid(api: BundleApi, problems: str) -> BundleFailure:
    return BundleFailure(
        BundleFailureCode.IR_INVALID,
        f"'{api.file}' is not valid under the IR JSON Schema: {problems}.",
        _FIX,
        api.file,
    )


def _is_number(value: object, expected: int) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and float(value) == float(expected)


def _shown(value: object) -> str:
    """A declared value in a message, as the compiler's `quote` shows it: a string quoted, a missing one `undefined`."""
    if isinstance(value, str):
        return quoted(value)

    return in_message(_plain(value))


def _plain(value: object) -> str:
    """A declared value as `String(value)` gives it: a string bare."""
    return "undefined" if value is Missing.ABSENT else shown(value)


def _support_failure(api: BundleApi, document: object) -> BundleFailure | None:
    for refusal in check_support(document, IrSupport.of_model(kinds=[])):
        code = _SUPPORT_CODES.get(refusal.code)

        # Kind, feature, must-act and nesting refusals are the generator's: it reads the IR again with its own
        # support, which this check, knowing no kind, lacks.
        if code is None:
            continue

        expected = ", ".join(refusal.expected)

        return BundleFailure(
            code,
            f"'{api.file}' holds {quoted(refusal.value)} at {quoted(refusal.member)}; this reader reads {expected}.",
            _FIX,
            api.file,
            expected,
            refusal.value,
        )

    return None


def _must_act_problems(document: object) -> list[str]:
    return [f"at {quoted(refusal.member)} an unknown {quoted(refusal.value)}" for refusal in check_must_act(document)]

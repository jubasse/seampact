"""The reader parity corpus (ADR 0010): this reader gives the TypeScript reader's verdict on every case.

The corpus is `packages/core/spec/vectors/ir/cases.json`; codes and members are compared, never message text.
"""

import copy
import json
from pathlib import Path
from typing import Any

from seampact.ir.model.version import IR_REVISION
from seampact.ir.read import IrMalformedError, IrRefusal, IrRefusedError, IrSupport, read_ir

_ACCEPT = "accept"
_MALFORMED = "malformed"
_NOT_JSON = "not-json"
_REFUSE = "refuse"
_MIN_CASES = 50

type Verdict = tuple[str, list[IrRefusal]]


def _corpus(repository_root: Path) -> dict[str, Any]:
    corpus: dict[str, Any] = json.loads(
        (repository_root / "packages/core/spec/vectors/ir/cases.json").read_text(encoding="utf-8")
    )

    return corpus


def _support_named(corpus: dict[str, Any], name: str) -> IrSupport:
    declared = corpus["supports"][name]

    return IrSupport(
        tuple(declared["irVersions"]),
        declared["irRevision"],
        tuple(declared["kinds"]),
        tuple(declared["features"]),
    )


def _pointer_segments(pointer: str) -> list[str]:
    return [segment.replace("~1", "/").replace("~0", "~") for segment in pointer.split("/")[1:]]


def _parent_of(document: Any, path: list[str]) -> Any:
    parent = document

    for segment in path[:-1]:
        parent = parent[int(segment)] if isinstance(parent, list) else parent[segment]

    return parent


def _replace_at(document: Any, path: list[str], value: Any) -> None:
    parent = _parent_of(document, path)

    if isinstance(parent, list):
        parent[int(path[-1])] = value
    else:
        parent[path[-1]] = value


def _literal_placeholder(index: int) -> str:
    return f"literal-placeholder-{index}"


def _document_text_of(case: dict[str, Any], repository_root: Path) -> str:
    example = repository_root / "packages/core/spec/schemas/ir/examples" / case["example"]
    document = json.loads(example.read_text(encoding="utf-8"))

    for edit in case.get("edits", []):
        path = _pointer_segments(edit["pointer"])

        if edit.get("remove") is True:
            del _parent_of(document, path)[path[-1]]
        else:
            _replace_at(document, path, copy.deepcopy(edit["value"]))

    literals = case.get("literals", [])

    for index, literal in enumerate(literals):
        _replace_at(document, _pointer_segments(literal["pointer"]), _literal_placeholder(index))

    text = json.dumps(document)

    for index, literal in enumerate(literals):
        text = text.replace(f'"{_literal_placeholder(index)}"', literal["text"])

    return text


def _verdict_of(text: str, support: IrSupport) -> Verdict:
    try:
        read_ir(text, support)
    except IrRefusedError as refused:
        return _REFUSE, sorted(refused.refusals, key=lambda refusal: (refusal.member, refusal.code.value))
    except IrMalformedError:
        return _MALFORMED, []

    return _ACCEPT, []


def _refusal_agrees(expected: dict[str, Any], actual: IrRefusal) -> bool:
    """Each field the corpus records; a support refusal, the one with an expected list, has its operation compared."""
    expected_list = expected.get("expected")

    return (
        expected["code"] == actual.code.value
        and expected["member"] == actual.member
        and expected.get("value", actual.value) == actual.value
        and (expected_list is None or tuple(expected_list) == actual.expected)
        and (expected_list is None or expected.get("operation") == actual.operation)
    )


def _agrees(verdict: dict[str, Any], actual: Verdict) -> bool:
    outcome = verdict["outcome"]

    # Text that is not JSON is malformed for every reader.
    if outcome == _NOT_JSON:
        return actual[0] == _MALFORMED

    expected_refusals = verdict.get("refusals", [])

    if outcome != actual[0] or len(expected_refusals) != len(actual[1]):
        return False

    return all(
        _refusal_agrees(expected, refusal) for expected, refusal in zip(expected_refusals, actual[1], strict=True)
    )


def test_matches_the_typescript_verdicts(repository_root: Path) -> None:
    corpus = _corpus(repository_root)
    cases = corpus["cases"]
    assert len(cases) > _MIN_CASES
    mismatches: list[str] = []

    for case in cases:
        actual = _verdict_of(_document_text_of(case, repository_root), _support_named(corpus, case["support"]))

        if not _agrees(case["verdict"], actual):
            shown = (actual[0], [(refusal.code.value, refusal.member, refusal.value) for refusal in actual[1]])
            mismatches.append(f"{case['id']}: expected {json.dumps(case['verdict'])}, got {shown}")

    assert mismatches == []


def test_the_corpus_is_built_for_this_revision(repository_root: Path) -> None:
    assert _corpus(repository_root)["irRevision"] == IR_REVISION

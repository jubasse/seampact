"""The request deadline the caller sends, refused when malformed or passed, and the version a concurrent write
carries, with the refusals a handler raises."""

import copy
import dataclasses
from datetime import UTC, datetime, timedelta

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.deadline import deadline_exceeded, request_deadline, sent_deadline
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.ir_view import IrJson
from seampact.codegen.runtime.version_token import sent_version, stale_version

_NOW = datetime(2026, 10, 18, 9, 0, 0, tzinfo=UTC)
_GET_TASK = "getTask"
_ARCHIVE_TASK = "archiveTask"
_PRECONDITION_FAILED = "api.precondition_failed"
_PRECONDITION_REQUIRED = "api.precondition_required"


def _with_deadline(value: str | None) -> DecodedInput:
    return DecodedInput({}, {}, {} if value is None else {"X-Deadline": value}, None, None)


def test_a_future_deadline_gives_the_time_left(tasks_service_contract: ApiContract) -> None:
    deadline = request_deadline(tasks_service_contract, _GET_TASK, _with_deadline("2026-10-18T09:00:00.300Z"), _NOW)

    assert deadline is not None
    assert deadline.remaining_ms(_NOW) == 300
    assert deadline.remaining_ms(_NOW + timedelta(seconds=1)) == 0


def test_a_passed_deadline_is_refused_with_its_role(tasks_service_contract: ApiContract) -> None:
    with pytest.raises(ContractRefusal) as refused:
        request_deadline(tasks_service_contract, _GET_TASK, _with_deadline("2026-10-18T08:59:59.999Z"), _NOW)

    assert refused.value.code == "api.deadline_exceeded"
    assert deadline_exceeded(tasks_service_contract, _GET_TASK).code == "api.deadline_exceeded"


def test_a_malformed_deadline_is_a_schema_issue(tasks_service_contract: ApiContract) -> None:
    with pytest.raises(ContractRefusal) as refused:
        request_deadline(tasks_service_contract, _GET_TASK, _with_deadline("soon"), _NOW)

    assert refused.value.code == "api.schema_invalid"
    assert refused.value.params == {"issues": [{"pointer": "/x-deadline", "rule": "format"}]}


def test_an_operation_without_a_deadline_header_reads_none(tasks_contract: ApiContract) -> None:
    assert request_deadline(tasks_contract, "searchTasks", _with_deadline(None), _NOW) is None


def test_a_header_text_reads_as_its_deadline_and_none_sent_as_none() -> None:
    deadline = sent_deadline("2026-10-18T11:00:00.300+02:00")

    assert deadline is not None
    assert deadline.remaining_ms(_NOW) == 300
    assert sent_deadline(None) is None


def test_the_sent_version_is_read_from_its_source(tasks_contract: ApiContract) -> None:
    decoded = DecodedInput({}, {}, {}, {"reason": "done", "expectedVersion": 4}, None)

    assert sent_version(tasks_contract, "archiveTask", decoded) == 4
    assert stale_version(tasks_contract, "archiveTask").code == "state.conflict"


def _if_match_contract(tasks_contract: ApiContract) -> ApiContract:
    """`archiveTask` versioned by `header.If-Match`, with the two codes the compiler derives for that source."""
    ir_view: dict[str, IrJson] = copy.deepcopy(dict(tasks_contract.ir_view))
    operations = ir_view["operations"]
    assert isinstance(operations, list)
    archive = next(op for op in operations if isinstance(op, dict) and op["id"] == _ARCHIVE_TASK)
    assert isinstance(archive, dict)
    archive["concurrency"] = {"field": "version", "version": {"in": "header", "name": "If-Match"}}
    errors = archive["errors"]
    assert isinstance(errors, list)
    errors[:] = [
        error for error in errors if not (isinstance(error, dict) and error.get("code") == "state.conflict")
    ] + [
        {"code": _PRECONDITION_FAILED, "roles": [{"role": "preconditionFailed"}]},
        {"code": _PRECONDITION_REQUIRED, "roles": [{"role": "preconditionRequired"}]},
    ]

    return dataclasses.replace(tasks_contract, ir_view=ir_view)


def _with_if_match(value: str | None) -> DecodedInput:
    return DecodedInput({}, {}, {} if value is None else {"If-Match": value}, {"reason": "done"}, None)


@pytest.mark.parametrize("sent", ['"7"', 'W/"7"'])
def test_an_if_match_version_is_the_unquoted_strong_or_weak_tag(tasks_contract: ApiContract, sent: str) -> None:
    contract = _if_match_contract(tasks_contract)

    assert sent_version(contract, _ARCHIVE_TASK, _with_if_match(sent)) == "7"


def test_a_stale_if_match_version_answers_precondition_failed(tasks_contract: ApiContract) -> None:
    contract = _if_match_contract(tasks_contract)

    assert stale_version(contract, _ARCHIVE_TASK).code == _PRECONDITION_FAILED


@pytest.mark.parametrize("sent", ['"7", "8"', "7", "W/7"])
def test_an_if_match_value_that_is_no_single_tag_answers_precondition_failed(
    tasks_contract: ApiContract, sent: str
) -> None:
    with pytest.raises(ContractRefusal) as refused:
        sent_version(_if_match_contract(tasks_contract), _ARCHIVE_TASK, _with_if_match(sent))

    assert refused.value.code == _PRECONDITION_FAILED


@pytest.mark.parametrize("sent", [None, "", " ", "*"])
def test_a_write_without_an_if_match_version_answers_precondition_required(
    tasks_contract: ApiContract, sent: str | None
) -> None:
    with pytest.raises(ContractRefusal) as refused:
        sent_version(_if_match_contract(tasks_contract), _ARCHIVE_TASK, _with_if_match(sent))

    assert refused.value.code == _PRECONDITION_REQUIRED

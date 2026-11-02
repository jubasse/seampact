"""The request deadline the caller sends, refused when malformed or passed, and the version a concurrent write
carries, with the refusals a handler raises."""

from datetime import UTC, datetime, timedelta

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.deadline import deadline_exceeded, request_deadline
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.version_token import sent_version, stale_version

_NOW = datetime(2026, 10, 18, 9, 0, 0, tzinfo=UTC)
_GET_TASK = "getTask"


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


def test_the_sent_version_is_read_from_its_source(tasks_contract: ApiContract) -> None:
    decoded = DecodedInput({}, {}, {}, {"reason": "done", "expectedVersion": 4}, None)

    assert sent_version(tasks_contract, "archiveTask", decoded) == 4
    assert stale_version(tasks_contract, "archiveTask").code == "state.conflict"

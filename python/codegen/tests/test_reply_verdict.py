"""Contract replies and the outgoing verdict (ADR 0016) on the reference contract's `getTask`."""

import gzip
import json
from pathlib import Path

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.replies import Reply, error_reply, json_bytes, role_params
from seampact.codegen.runtime.reply_verdict import (
    AuthoredReplies,
    FrameworkEtagMode,
    OutgoingReply,
    ResponsesMode,
    Verdict,
    verdict,
)

_GET_TASK = "getTask"
_JSON = ("content-type", "application/json")


@pytest.fixture(scope="module")
def tasks(repository_root: Path) -> ApiContract:
    ir_view = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))

    return ApiContract(api="tasks", generated_by="0.0.0-dev", mount="", ir_view=ir_view, members={})


def _judge(
    contract: ApiContract,
    reply: OutgoingReply,
    *,
    authored: AuthoredReplies | None = None,
    method: str = "GET",
    admitted: bool = False,
    responses: ResponsesMode = ResponsesMode.STRICT,
    framework_etag: FrameworkEtagMode = FrameworkEtagMode.STRIP,
) -> Verdict:
    return verdict(
        contract,
        _GET_TASK,
        reply,
        authored=authored or AuthoredReplies(),
        method=method,
        admitted=admitted,
        responses=responses,
        framework_etag=framework_etag,
    )


def _outgoing(reply: Reply) -> OutgoingReply:
    return OutgoingReply(reply.status, reply.headers, reply.body)


def _body(reply: Reply | OutgoingReply) -> object:
    assert reply.body is not None
    return json.loads(reply.body)


def test_an_error_reply_renders_the_code_in_the_operations_format(tasks: ApiContract) -> None:
    reply = error_reply(tasks, _GET_TASK, "api.not_found")

    assert reply.status == 404
    assert reply.header("Content-Type") == "application/problem+json"
    assert _body(reply) == {"code": "api.not_found", "nature": "refused", "status": 404, "type": "api.not_found"}


def test_a_role_renders_only_the_params_its_binding_names(tasks: ApiContract) -> None:
    issues = [{"in": "path", "pointer": "/taskId", "rule": "format"}]
    params = role_params(tasks, _GET_TASK, "api.schema_invalid", "schemaInvalid", {"issues": issues})

    assert params == {"issues": [{"pointer": "/taskId", "rule": "format"}]}


def test_the_boundarys_json_keeps_unicode_and_zero_fractions() -> None:
    assert json_bytes({"a": "café/", "b": 1.0}) == '{"a":"café/","b":1.0}'.encode()

    with pytest.raises(ValueError):
        json_bytes(float("nan"))


def test_a_reply_the_boundary_wrote_passes_with_its_etag(tasks: ApiContract) -> None:
    authored = AuthoredReplies()
    written = authored.author(Reply(200, (_JSON, ("etag", '"v1"')), b"{}"))

    judged = _judge(tasks, _outgoing(written), authored=authored)

    assert judged == Verdict(_outgoing(written), None, replaced=False)


def test_a_head_reply_whose_body_the_server_emptied_is_still_the_boundarys(tasks: ApiContract) -> None:
    authored = AuthoredReplies()
    authored.author(Reply(200, (_JSON,), b"{}"))

    assert _judge(tasks, OutgoingReply(200, (_JSON,), b""), authored=authored, method="HEAD").violation is None


def test_a_success_the_boundary_did_not_write_is_replaced_by_the_apis_500(tasks: ApiContract) -> None:
    judged = _judge(tasks, OutgoingReply(200, (_JSON,), b"{}"))

    assert judged.violation == "a 200 reply the boundary did not write"
    assert judged.replaced
    assert judged.reply.status == 500
    assert _body(judged.reply) == {"code": "api.internal", "nature": "failed", "status": 500, "type": "api.internal"}


def test_under_warn_a_violation_goes_out_as_written(tasks: ApiContract) -> None:
    reply = OutgoingReply(418, (), b"")
    judged = _judge(tasks, reply, responses=ResponsesMode.WARN)

    assert judged == Verdict(reply, "the undeclared status 418", replaced=False)


def test_a_declared_error_from_a_native_layer_passes_with_a_declared_code(tasks: ApiContract) -> None:
    reply = _outgoing(error_reply(tasks, _GET_TASK, "api.unauthenticated"))

    assert _judge(tasks, reply).violation is None


def test_a_declared_error_compressed_by_a_later_layer_is_decoded_first(tasks: ApiContract) -> None:
    written = error_reply(tasks, _GET_TASK, "api.unauthenticated")
    reply = OutgoingReply(401, (*written.headers, ("content-encoding", "gzip")), gzip.compress(written.body))

    assert _judge(tasks, reply).violation is None


@pytest.mark.parametrize(
    ("reply", "violation"),
    [
        (OutgoingReply(401, (_JSON,), b"{}"), "a 401 error body that is not application/problem+json"),
        (
            OutgoingReply(401, (("content-type", "application/problem+json"), ("content-encoding", "br")), b"x"),
            "a 401 error body in the content coding 'br', which the boundary cannot decode",
        ),
        (
            OutgoingReply(401, (("content-type", "application/problem+json"),), b"{"),
            "a 401 error body that is not JSON",
        ),
        (
            OutgoingReply(401, (("content-type", "application/problem+json"),), b'{"code":"api.forbidden"}'),
            "a 401 error body without a declared code",
        ),
        (OutgoingReply(401, (), None), "a 401 error body that cannot be checked"),
    ],
)
def test_a_declared_error_without_a_declared_code_is_a_violation(
    tasks: ApiContract, reply: OutgoingReply, violation: str
) -> None:
    assert _judge(tasks, reply).violation == violation


def test_once_admitted_only_the_boundary_writes_an_error(tasks: ApiContract) -> None:
    reply = _outgoing(error_reply(tasks, _GET_TASK, "api.unauthenticated"))

    assert _judge(tasks, reply, admitted=True).violation == (
        "a 401 reply written after the boundary's access step admitted the request"
    )


def test_a_foreign_etag_is_stripped_unless_kept(tasks: ApiContract) -> None:
    written = error_reply(tasks, _GET_TASK, "api.unauthenticated")
    reply = OutgoingReply(401, (*written.headers, ("etag", '"framework"')), written.body)

    assert _judge(tasks, reply).reply.header("etag") is None
    assert _judge(tasks, reply, framework_etag=FrameworkEtagMode.KEEP).reply.header("etag") == '"framework"'

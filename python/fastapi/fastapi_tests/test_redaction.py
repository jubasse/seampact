"""A generated class of each kind that holds a secret (ADR 0026 "Redaction"): the Pydantic model of a sensitive member,
an identity's credentials, a replayed idempotent reply and the boundary's request state never show it through `repr`,
`str`, `pprint`, `logging` with `%r` or `rich`, and print `[redacted]` instead."""

import importlib
import io
import logging
import pprint
from collections.abc import Callable
from typing import Final

import pydantic
import pytest
import rich.pretty

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.idempotency import IdempotencyReplayed
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.raw_target import RawTarget
from seampact.codegen.runtime.replies import Reply
from seampact.fastapi.runtime.input_features import ReplayedReply
from seampact.fastapi.runtime.request_state import RequestState

_SECRET: Final = "s3cret-value-of-the-test"
_REDACTED: Final = "[redacted]"
_GOLDEN_API: Final = "fastapi_tests.golden.reference.tasks"


def _golden(module: str, name: str) -> object:
    return getattr(importlib.import_module(f"{_GOLDEN_API}.{module}"), name)


def _golden_class(module: str, name: str) -> Callable[..., object]:
    built = _golden(module, name)
    assert callable(built)

    return built


def _contract() -> ApiContract:
    contract = _golden("contract", "CONTRACT")
    assert isinstance(contract, ApiContract)

    return contract


def _proofs(reauth_token: str) -> pydantic.BaseModel:
    proofs = _golden_class("schemas", "PurgeTaskProofs")(reauth_token=reauth_token)
    assert isinstance(proofs, pydantic.BaseModel)

    return proofs


def _logged(value: object) -> str:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    logger = logging.getLogger("fastapi_tests.redaction")
    logger.addHandler(handler)

    try:
        logger.warning("held %r", value)
    finally:
        logger.removeHandler(handler)

    return stream.getvalue()


def _rich(value: object) -> str:
    return rich.pretty.pretty_repr(value)


_RENDERINGS: Final[dict[str, Callable[[object], str]]] = {
    "repr": repr,
    "str": str,
    "pprint": pprint.pformat,
    "logging": _logged,
    "rich": _rich,
}


def _secret_holders() -> dict[str, object]:
    reply = Reply(200, (("content-type", "application/json"),), f'{{"token":"{_SECRET}"}}'.encode())
    decoded = DecodedInput({}, {"q": _SECRET}, {}, {"title": _SECRET}, _SECRET.encode())
    state = RequestState(
        contract=_contract(),
        operation_id="getTask",
        method="GET",
        target=RawTarget(path="/v1/tasks", query=f"q={_SECRET}", raw=True),
        raw_parameters={"taskId": _SECRET},
        decoded=decoded,
        typed_request=_SECRET,
        input_query={"q": _SECRET},
    )

    return {
        "sensitive model member": _proofs(_SECRET),
        "identity credentials": _golden_class("operations", "UserCredentials")(bearer=_SECRET, session_cookie=_SECRET),
        "replayed reply": ReplayedReply("tasks", IdempotencyReplayed(reply)),
        "request state": state,
    }


@pytest.mark.parametrize("rendering", sorted(_RENDERINGS))
@pytest.mark.parametrize("holder", sorted(_secret_holders()))
def test_a_secret_is_printed_redacted(holder: str, rendering: str) -> None:
    printed = _RENDERINGS[rendering](_secret_holders()[holder])

    assert _SECRET not in printed
    assert _REDACTED in printed


def test_a_sensitive_model_member_stays_readable_by_the_handler() -> None:
    proofs = _proofs(_SECRET)

    assert getattr(proofs, "reauth_token") == _SECRET  # noqa: B009 - the golden model is not type-checked here
    assert proofs.model_dump() == {"reauth_token": _SECRET}

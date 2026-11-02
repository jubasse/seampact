"""The operation features around steps 6 to 8 of one contract request, in the order every target runs them: the sent
version first, so a missing `If-Match` answers `preconditionRequired` and never `schemaInvalid`; the typed input as
sent; the paged list's limit filled in and the input field rights, which leave out or refuse a restricted member;
then the deadline. The idempotency claim comes next, in the placement, which holds the store."""

import dataclasses
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState, HookCaller
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.deadline import request_deadline
from seampact.codegen.runtime.field_rights import checked_input_fields
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.ir_view import ir_map, ir_string
from seampact.codegen.runtime.page_reply import filled_page_query
from seampact.codegen.runtime.pydantic.contract_input import InputBuilder
from seampact.codegen.runtime.version_token import sent_version

_HEADER_SOURCE: Final = "header"


@dataclass(frozen=True, slots=True)
class CheckedInput:
    """The typed request the handler receives, and the decoded input it was built from: the filled page limit and
    the body its field rights leave."""

    typed: object
    decoded: DecodedInput


async def checked_input(
    contract: ApiContract,
    operation_id: str,
    decoded: DecodedInput,
    raw_query: str,
    access: AccessState,
    hooks: AccessHooks,
    builder: InputBuilder,
    call: HookCaller,
) -> CheckedInput:
    """Raises `ContractRefusal` for a refused input and `BoundaryFailureError` for a hook's undeclared answer."""
    sent = _with_sent_version(contract, operation_id, decoded)
    typed = builder.build(sent, access, raw_query)
    filled_query = filled_page_query(contract, operation_id, sent.query)
    checked_body = await checked_input_fields(access, hooks, call)
    handed = dataclasses.replace(sent, query=filled_query, body=checked_body)

    # The input as sent was checked; the handler receives the filled limit and the body its field rights leave.
    if filled_query != sent.query or checked_body != sent.body:
        typed = builder.build(handed, access, raw_query)

    request_deadline(contract, operation_id, handed, datetime.now(UTC))

    return CheckedInput(typed, handed)


def _with_sent_version(contract: ApiContract, operation_id: str, decoded: DecodedInput) -> DecodedInput:
    """The decoded input with a header version unquoted (`If-Match: "7"` reads `7`), as the handler compares it."""
    concurrency = ir_map(contract.operation(operation_id), "concurrency")

    if not concurrency:
        return decoded

    version = sent_version(contract, operation_id, decoded)
    source = ir_map(concurrency, "version")

    if ir_string(source, "in") != _HEADER_SOURCE:
        return decoded

    headers = {**decoded.headers, ir_string(source, "name") or "": version}

    return dataclasses.replace(decoded, headers=headers)

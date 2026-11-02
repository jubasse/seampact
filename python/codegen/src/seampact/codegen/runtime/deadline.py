"""The request deadline (grammar section 9, a header of semantic `deadline`): an RFC 3339 instant the caller sends in
the operation's `deadlineHeader`. The boundary refuses a malformed one with `schemaInvalid` and a passed one with the
`deadlineExceeded` role's code; the generated request's `deadline` gives the handler the time left. An operation's
`budgetMs` alone is the client's default timeout: the server receives nothing of it beside this header."""

from dataclasses import dataclass
from datetime import datetime
from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.input_decoding import DecodedInput, Issue, role_refusal, schema_invalid
from seampact.codegen.runtime.ir_view import ir_string
from seampact.codegen.runtime.value_rules import ValueRuleError, date_time_from_text

DEADLINE_EXCEEDED_ROLE: Final = "deadlineExceeded"

_HEADER_PART: Final = "header"
_FORMAT_RULE: Final = "format"
_MILLISECONDS_PER_SECOND: Final = 1000


@dataclass(frozen=True, slots=True)
class RequestDeadline:
    """The instant the caller stops waiting, aware of its offset."""

    at: datetime

    def remaining_ms(self, now: datetime) -> int:
        """The whole milliseconds left at `now`, 0 once the deadline has passed."""
        return max(int((self.at - now).total_seconds() * _MILLISECONDS_PER_SECOND), 0)

    def has_passed(self, now: datetime) -> bool:
        return now >= self.at


def request_deadline(
    contract: ApiContract, operation_id: str, decoded: DecodedInput, now: datetime
) -> RequestDeadline | None:
    """The deadline the request carries, None when the operation reads none or the caller sent none (a required
    header was refused by the input step).

    Raises `ContractRefusal` for a malformed deadline, or one passed at `now`."""
    header = ir_string(contract.operation(operation_id), "deadlineHeader")
    sent = None if header is None else decoded.headers.get(header)

    if header is None or sent is None:
        return None

    try:
        deadline = RequestDeadline(date_time_from_text(str(sent)))
    except ValueRuleError:
        raise schema_invalid(
            contract, operation_id, [Issue(_HEADER_PART, f"/{header.lower()}", _FORMAT_RULE)]
        ) from None

    if deadline.has_passed(now):
        raise deadline_exceeded(contract, operation_id)

    return deadline


def sent_deadline(text: str | None) -> RequestDeadline | None:
    """The deadline a header's text carries, None when the caller sent none.

    Raises `ValueRuleError` for a text that is not an RFC 3339 instant with its offset."""
    return None if text is None else RequestDeadline(date_time_from_text(text))


def deadline_exceeded(contract: ApiContract, operation_id: str) -> ContractRefusal:
    """The refusal a handler raises when the deadline passes while it works."""
    return role_refusal(contract, operation_id, DEADLINE_EXCEEDED_ROLE)

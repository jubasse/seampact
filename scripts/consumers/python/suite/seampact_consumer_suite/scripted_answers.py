"""What the loaded script tells the doubles: the failure a hook double raises, the denial a scope gets, and the answer a handler gives
in place of its own (its success built from the script's body, a declared error arm, a raised exception, or a reply the
result type cannot hold, raised as ScriptedReply for the app to write itself). A held handler answers once released,
from the script loaded then."""

import time
from collections.abc import Callable, Mapping
from typing import Final

from seampact_consumer_suite.control_state import loaded_script, record_hook_call

DEFAULT_API: Final = "tasks"
_SCRIPTED_FAILURE: Final = "scripted failure"
_HOLD_HOOK: Final = "hold"
# Below the suite's request timeout, so a hold the suite never releases still answers.
_HOLD_LIMIT_SECONDS: Final = 5.0
_HOLD_POLL_SECONDS: Final = 0.01


class ScriptedReply(Exception):  # noqa: N818 - a reply the app writes, not an error
    """A scripted reply the result type cannot hold, from the status, headers and body this carries."""

    def __init__(self, status: int, error_code: str, reply_body: object) -> None:
        super().__init__(f"scripted reply {status}")
        self.status = status
        self.error_code = error_code
        self.reply_body = reply_body

    def body(self) -> object:
        return self.reply_body if self.error_code == "" else {"code": self.error_code, "status": self.status}

    def headers(self) -> dict[str, str]:
        return {} if self.error_code == "" else {"content-type": "application/problem+json"}


class ScriptedHookFailure(Exception):  # noqa: N818 - the failure a script gives a hook double
    """The exception a hook double raises in place of its answer when the script names it in `hookFailures`."""


def raise_scripted_hook_failure(hook: str) -> None:
    """Raises the failure the script gives the hook double named `hook`, if any."""
    failures = loaded_script().get("hookFailures")
    message = failures.get(hook) if isinstance(failures, dict) else None

    if isinstance(message, str):
        raise ScriptedHookFailure(message)


def scripted_scope_denial(scope: str) -> str | None:
    scopes = loaded_script().get("scopes")
    scripted = scopes.get(scope) if isinstance(scopes, dict) else None

    return _denial_code(scripted) if isinstance(scripted, dict) else None


def scripted_answer[Result](
    operation: str,
    success_status: int,
    success: Callable[[dict[str, object]], Result],
    error_arms: Mapping[str, Callable[[], Result]] | None = None,
    api: str = DEFAULT_API,
) -> Result | None:
    """None when the script gives the operation no answer."""
    if is_held(api, operation):
        wait_for_release(api, operation)

    answers = loaded_script().get("answers")
    answer = answers.get(f"{api}.{operation}") if isinstance(answers, dict) else None

    if not isinstance(answer, dict):
        return None

    if "throws" in answer:
        throws = answer["throws"]
        raise RuntimeError(throws if isinstance(throws, str) else _SCRIPTED_FAILURE)

    status = answer.get("status")
    code = answer.get("code")
    body = answer.get("body")
    status = status if isinstance(status, int) else 0
    code = code if isinstance(code, str) else ""
    arms = error_arms or {}

    if code in arms:
        return arms[code]()

    if code == "" and status == success_status and isinstance(body, dict):
        return success(body)

    raise ScriptedReply(status, code, body)


def is_held(api: str, operation: str) -> bool:
    """Whether the script holds the operation's handler until a script that does not is loaded."""
    holds = loaded_script().get("holds")

    return isinstance(holds, list) and f"{api}.{operation}" in holds


def wait_for_release(api: str, operation: str) -> None:
    """Records the hold, then waits until the operation is released or the hold limit has passed."""
    record_hook_call(_HOLD_HOOK, api, operation)
    deadline = time.monotonic() + _HOLD_LIMIT_SECONDS

    while is_held(api, operation) and time.monotonic() < deadline:
        time.sleep(_HOLD_POLL_SECONDS)


def text_member(body: Mapping[str, object], member: str) -> str:
    value = body.get(member)

    if not isinstance(value, str):
        raise ValueError(f"the scripted body holds no text '{member}'")

    return value


def _denial_code(scripted: Mapping[str, object]) -> str:
    deny = scripted.get("deny")
    code = deny.get("code") if isinstance(deny, dict) else None

    if not isinstance(code, str):
        raise ValueError("the loaded script holds a denial without a code")

    return code

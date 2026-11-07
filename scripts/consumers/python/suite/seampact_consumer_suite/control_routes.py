"""The suite's control routes (ADR 0015 "Control routes") as framework-neutral replies; each app serves them at these
paths with its own routing."""

import json
from dataclasses import dataclass
from typing import Final

from seampact_consumer_suite.control_state import ScriptError, hook_calls, load_script, log_lines

SCRIPT_PATH: Final = "/__seampact/script"
HOOK_CALLS_PATH: Final = "/__seampact/hook-calls"
LOG_LINES_PATH: Final = "/__seampact/log-lines"
_JSON: Final = "application/json"
_TEXT: Final = "text/plain"


@dataclass(frozen=True, slots=True)
class ControlReply:
    status: int
    content_type: str | None
    body: bytes


def script_reply(body: bytes) -> ControlReply:
    try:
        load_script(body)
    except ScriptError as refused:
        return ControlReply(400, _TEXT, str(refused).encode())

    return ControlReply(204, None, b"")


def hook_calls_reply() -> ControlReply:
    return ControlReply(200, _JSON, json.dumps({"calls": hook_calls()}).encode())


def log_lines_reply() -> ControlReply:
    return ControlReply(200, _JSON, json.dumps({"lines": log_lines()}).encode())

"""The script a case loads, the hook calls the doubles record and the log lines the app writes. A server may run
several worker processes, so all three live in one JSON file, read and written under a lock."""

import fcntl
import json
from collections.abc import Callable
from typing import Final, TypedDict

from seampact_consumer_suite.suite_files import suite_files

SCRIPT_MEMBERS: Final = ("decisions", "scopes", "answers", "holds")


class HookCall(TypedDict):
    hook: str
    operation: str


class ControlState(TypedDict):
    script: dict[str, object]
    recording: bool
    hookCalls: list[HookCall]
    logLines: list[str]


class ScriptError(ValueError):
    """The body a case loaded is not a script."""


def load_script(body: bytes) -> None:
    """Loads the JSON `body` as the script and empties the records; raises ScriptError naming why it is not one."""
    try:
        script = json.loads(body)
    except ValueError as malformed:
        raise ScriptError(f"the script is not JSON: {malformed}") from malformed

    if not isinstance(script, dict):
        raise ScriptError("the script is not a JSON object")

    for member in script:
        if member not in SCRIPT_MEMBERS:
            raise ScriptError(f"the script member '{member}' is not one of {', '.join(SCRIPT_MEMBERS)}")

    _update(lambda _state: ControlState(script=script, recording=True, hookCalls=[], logLines=[]))


def hook_calls() -> list[HookCall]:
    return _read()["hookCalls"]


def log_lines() -> list[str]:
    return _read()["logLines"]


def loaded_script() -> dict[str, object]:
    return _read()["script"]


def record_hook_call(hook: str, api: str, operation: str) -> None:
    def recorded(state: ControlState) -> ControlState:
        if state["recording"]:
            state["hookCalls"].append(HookCall(hook=hook, operation=f"{api}.{operation}"))

        return state

    _update(recorded)


def write_log_line(line: str) -> None:
    def written(state: ControlState) -> ControlState:
        state["logLines"].append(line)

        return state

    _update(written)


def _read() -> ControlState:
    with open(_path(), "a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_SH)
        handle.seek(0)

        return _decoded(handle.read())


def _update(change: Callable[[ControlState], ControlState]) -> None:
    with open(_path(), "a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.seek(0)
        state = change(_decoded(handle.read()))
        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps(state))


def _decoded(contents: str) -> ControlState:
    if contents == "":
        return ControlState(script={}, recording=False, hookCalls=[], logLines=[])

    state: ControlState = json.loads(contents)

    return state


def _path() -> str:
    return suite_files().control_state

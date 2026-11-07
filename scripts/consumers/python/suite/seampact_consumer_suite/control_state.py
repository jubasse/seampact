"""The script a case loads, the hook calls the doubles record and the log lines the app writes. A server may run
several worker processes, so all three live in one JSON file, read and written under a lock."""

import fcntl
import json
import uuid
from collections.abc import Callable
from typing import Final, NotRequired, TypedDict

from seampact_consumer_suite.suite_files import suite_files

from seampact.hooks import ThrottleBucket

SCRIPT_MEMBERS: Final = ("decisions", "scopes", "answers", "holds", "hookFailures")


class RecordedBucket(TypedDict):
    """A throttle bucket as the hook-calls route answers it: the key digest is left out."""

    id: str
    values: list[object]
    limit: NotRequired[int]
    windowMs: NotRequired[int]


class HookCall(TypedDict):
    hook: str
    operation: str
    bucket: NotRequired[RecordedBucket]


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


def record_hook_call(hook: str, api: str, operation: str, bucket: ThrottleBucket | None = None) -> None:
    call = HookCall(hook=hook, operation=f"{api}.{operation}")

    if bucket is not None:
        call["bucket"] = _recorded_bucket(bucket)

    def recorded(state: ControlState) -> ControlState:
        if state["recording"]:
            state["hookCalls"].append(call)

        return state

    _update(recorded)


def _recorded_bucket(bucket: ThrottleBucket) -> RecordedBucket:
    recorded = RecordedBucket(id=bucket.id, values=[_json_value(value) for value in bucket.values])

    if bucket.limit is not None:
        recorded["limit"] = bucket.limit

    if bucket.window_ms is not None:
        recorded["windowMs"] = bucket.window_ms

    return recorded


# A key value is a string, a number or an id the generated principal types as a UUID.
def _json_value(value: object) -> object:
    if isinstance(value, uuid.UUID):
        return str(value)

    if value is None or isinstance(value, str | int | float | bool):
        return value

    raise TypeError(f"the bucket key value {value!r} is not one the hook-calls route can answer as JSON")


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

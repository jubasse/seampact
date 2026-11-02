"""The app's idempotency store for the suite: one JSON file beside the suite's control state, read and written under a
lock, since uvicorn may run several workers; entries are kept for their lifetime."""

import base64
import fcntl
import json
import time
from collections.abc import Callable
from typing import Final, TypedDict

from seampact.hooks import IdempotencyBegin, IdempotencyClaim, StoredResponse, idempotency_begin

_MILLISECONDS_PER_SECOND: Final = 1000


class _Stored(TypedDict):
    status: int
    headers: list[tuple[str, str]]
    body: str


class _Entry(TypedDict):
    fingerprint: str
    expiresAtMs: int
    response: _Stored | None


type _Entries = dict[str, _Entry]


class FileIdempotencyStore:
    def __init__(self, path: str) -> None:
        self._path = path

    def begin(self, claim: IdempotencyClaim) -> IdempotencyBegin:
        def claimed(entries: _Entries) -> IdempotencyBegin:
            now_ms = _now_ms()

            # A running entry expires too, so a request that never settled does not hold its key for the app's life.
            for key in [key for key, entry in entries.items() if entry["expiresAtMs"] <= now_ms]:
                del entries[key]

            existing = entries.get(claim.key)

            if existing is None:
                entries[claim.key] = _Entry(
                    fingerprint=claim.fingerprint, expiresAtMs=now_ms + claim.lifetime_ms, response=None
                )
                return idempotency_begin.Started()

            if existing["fingerprint"] != claim.fingerprint:
                return idempotency_begin.Mismatch()

            stored = existing["response"]

            if stored is None:
                return idempotency_begin.Running()

            return idempotency_begin.Replay(response=_response_of(stored))

        return self._changed(claimed)

    def complete(self, key: str, response: StoredResponse) -> None:
        def completed(entries: _Entries) -> None:
            entry = entries.get(key)

            if entry is not None:
                entry["response"] = _Stored(
                    status=response.status,
                    headers=[(header.name, header.value) for header in response.headers],
                    body=base64.b64encode(response.body).decode("ascii"),
                )

        self._changed(completed)

    def abandon(self, key: str) -> None:
        def abandoned(entries: _Entries) -> None:
            entries.pop(key, None)

        self._changed(abandoned)

    def _changed[T](self, change: Callable[[_Entries], T]) -> T:
        with open(self._path, "a+", encoding="utf-8") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            handle.seek(0)
            contents = handle.read()
            entries: _Entries = json.loads(contents) if contents else {}
            result = change(entries)
            handle.seek(0)
            handle.truncate()
            handle.write(json.dumps(entries))

        return result


def _response_of(stored: _Stored) -> StoredResponse:
    headers = tuple(StoredResponse.Header(name=name, value=value) for name, value in stored["headers"])

    return StoredResponse(status=stored["status"], headers=headers, body=base64.b64decode(stored["body"]))


def _now_ms() -> int:
    return int(time.time() * _MILLISECONDS_PER_SECOND)

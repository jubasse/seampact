"""The app's idempotency store for the suite: one JSON file beside the suite's control state, locked while it changes,
since gunicorn and uvicorn run several workers; an entry is kept for its lifetime."""

import base64
import fcntl
import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Final

from django.http import HttpRequest

from seampact.hooks import IdempotencyBegin, IdempotencyClaim, StoredResponse, idempotency_begin

STORE_FILE: Final = Path(__file__).parent / "suite-idempotency.json"
_MILLISECONDS_PER_SECOND: Final = 1000

type Entries = dict[str, dict[str, object]]


class FileIdempotencyStore:
    def begin(self, claim: IdempotencyClaim) -> IdempotencyBegin:
        def begun(entries: Entries) -> IdempotencyBegin:
            now_ms = _now_ms()

            # A running entry expires too, so a request that never settled does not hold its key for the app's life.
            for key in [key for key, entry in entries.items() if _expires_at(entry) <= now_ms]:
                del entries[key]

            existing = entries.get(claim.key)

            if existing is None:
                entries[claim.key] = {
                    "fingerprint": claim.fingerprint,
                    "expiresAtMs": now_ms + claim.lifetime_ms,
                    "response": None,
                }
                return idempotency_begin.Started()

            if existing["fingerprint"] != claim.fingerprint:
                return idempotency_begin.Mismatch()

            stored = existing["response"]

            return idempotency_begin.Running() if stored is None else idempotency_begin.Replay(response=_stored(stored))

        return _changed(begun)

    def complete(self, key: str, response: StoredResponse) -> None:
        def completed(entries: Entries) -> None:
            if key in entries:
                entries[key]["response"] = {
                    "status": response.status,
                    "headers": [[header.name, header.value] for header in response.headers],
                    "body": base64.b64encode(response.body).decode("ascii"),
                }

        _changed(completed)

    def abandon(self, key: str) -> None:
        def abandoned(entries: Entries) -> None:
            entries.pop(key, None)

        _changed(abandoned)


def idempotency_store(request: HttpRequest) -> FileIdempotencyStore:
    return FileIdempotencyStore()


def _changed[T](change: Callable[[Entries], T]) -> T:
    """Runs `change` on the entries under an exclusive lock and writes them back."""
    with STORE_FILE.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.seek(0)
        contents = handle.read()
        entries: Entries = json.loads(contents) if contents else {}
        result = change(entries)
        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps(entries))

        return result


def _stored(stored: object) -> StoredResponse:
    if not isinstance(stored, dict):
        raise ValueError("the suite idempotency store holds a response that is not an object")

    headers = tuple(StoredResponse.Header(name=name, value=value) for name, value in stored["headers"])

    return StoredResponse(status=stored["status"], headers=headers, body=base64.b64decode(stored["body"]))


def _expires_at(entry: dict[str, object]) -> int:
    expires_at = entry["expiresAtMs"]

    return expires_at if isinstance(expires_at, int) else 0


def _now_ms() -> int:
    return int(time.time() * _MILLISECONDS_PER_SECOND)

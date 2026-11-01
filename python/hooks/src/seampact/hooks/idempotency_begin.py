"""The idempotency store's answer to a claim: started, still running, a fingerprint mismatch, or a replay."""

from dataclasses import dataclass

from seampact.hooks.stored_response import StoredResponse


@dataclass(frozen=True, slots=True, kw_only=True)
class Started:
    pass


@dataclass(frozen=True, slots=True, kw_only=True)
class Running:
    pass


@dataclass(frozen=True, slots=True, kw_only=True)
class Mismatch:
    pass


@dataclass(frozen=True, slots=True, kw_only=True)
class Replay:
    response: StoredResponse


type IdempotencyBegin = Started | Running | Mismatch | Replay

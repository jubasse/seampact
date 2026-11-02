"""One failure the boundary answered with the api's 500: the api, the operation when one matched, a reason that holds
no input value, and the exception when one was raised."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True, kw_only=True)
class UnexpectedFailure:
    api: str
    operation: str | None
    reason: str
    cause: BaseException | None = None

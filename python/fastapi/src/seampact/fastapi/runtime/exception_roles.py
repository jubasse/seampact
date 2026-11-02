"""The role of an `HTTPException` the app's handlers rendered on a contract route (ADR 0026 "Exceptions on contract
routes"): 401 `unauthenticated`, 403 `forbidden`, 404 `notFound`, 413 `payloadTooLarge`, 429 `rateLimited` and 503
`serviceUnavailable`, the last two keeping `Retry-After`. The reply is the code of its role when the operation declares
one, else the operation's single code of that status, with the params its role binding renders; else the api's 500,
logged. Another status is left to the outgoing check."""

from typing import Final

from starlette.exceptions import HTTPException

from seampact.codegen.runtime.replies import Reply, error_reply, internal_error_reply, role_params
from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.request_state import RequestState

_ROLES: Final = {
    401: "unauthenticated",
    403: "forbidden",
    404: "notFound",
    413: "payloadTooLarge",
    429: "rateLimited",
    503: "serviceUnavailable",
}
_RETRY_AFTER: Final = "retry-after"
_MILLISECONDS_PER_SECOND: Final = 1000


def exception_reply(binding: ApiBinding, state: RequestState, exception: HTTPException) -> Reply | None:
    """The reply of the exception's role, None for a status that has no role."""
    role = _ROLES.get(exception.status_code)

    if role is None:
        return None

    contract = state.contract
    operation_id = state.operation_id
    code = contract.role_code(operation_id, role)

    if code is None:
        declared = contract.declared_codes(operation_id, exception.status_code)
        code = declared[0] if len(declared) == 1 else None

    if code is None:
        return _internal(binding, state, role, "the operation declares no code for it")

    slots: dict[str, object] = {}
    retry_after_ms = _retry_after_ms(exception)

    if retry_after_ms is not None:
        slots["retryAfterMs"] = retry_after_ms

    params = role_params(contract, operation_id, code, role, slots)
    needs_params = contract.catalog_entry(code).get("params") is not None

    if needs_params and params is None:
        return _internal(binding, state, role, f"the code '{code}' requires params the exception does not give")

    return error_reply(contract, operation_id, code, params)


def _internal(binding: ApiBinding, state: RequestState, role: str, reason: str) -> Reply:
    binding.logger.error(
        "seampact: an HTTPException on operation '%s' took the role '%s', and %s; the reply is the api's 500.",
        state.operation_id,
        role,
        reason,
    )

    return internal_error_reply(state.contract, state.operation_id)


def _retry_after_ms(exception: HTTPException) -> int | None:
    headers = exception.headers or {}
    value = next((text for name, text in headers.items() if name.lower() == _RETRY_AFTER), None)

    if value is None or not value.strip().isdigit():
        return None

    return int(value.strip()) * _MILLISECONDS_PER_SECOND

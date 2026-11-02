"""Idempotency at the boundary (ADR 0012 "Target obligations"): after the input step, the claim's fixed-size key and
fingerprint, and the replay, running and mismatch answers; once the reply is written, the record completed with the
reply that went out, or abandoned after a server error or an error that forbids storing."""

from dataclasses import dataclass
from typing import ClassVar, Final

from seampact.codegen.runtime.access_steps import HookCaller
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.digests import hex_of
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.input_decoding import DecodedInput, role_refusal
from seampact.codegen.runtime.ir_view import IrMap, ir_int, ir_map, ir_maps, ir_string, ir_strings
from seampact.codegen.runtime.principal_members import principal_members
from seampact.codegen.runtime.replies import CACHE_CONTROL, CONTENT_TYPE, NO_STORE, Reply
from seampact.hooks import IdempotencyClaim, IdempotencyStore, OperationRef, StoredResponse, idempotency_begin
from seampact.hooks._redaction import RedactedRepr

IN_PROGRESS_ROLE: Final = "idempotencyInProgress"
KEY_REUSED_ROLE: Final = "idempotencyKeyReused"

_DERIVED: Final = "derived"
_BOUNDARY: Final = "boundary"
_UNION_TAG_DERIVATION: Final = "union.headerTag"
_CONTENT_HEADER_PREFIX: Final = "content-"
_AUTHORIZATION_HEADER: Final = "authorization"
_REPLAYED: Final = "true"
_CLIENT_ERROR_FLOOR: Final = 400
_SERVER_ERROR_FLOOR: Final = 500


@dataclass(frozen=True, slots=True)
class IdempotencyClaimed:
    """The request holds the record of `key`: its handler runs, then the placement settles the record."""

    key: str


@dataclass(frozen=True, slots=True, repr=False)
class IdempotencyReplayed(RedactedRepr):
    """The stored reply of an earlier request with the same key and input: the handler must not run. Its repr hides
    the reply, whose body and headers the store keeps redacted too."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"reply"})

    reply: Reply


@dataclass(frozen=True, slots=True)
class IdempotencyStoreFailure:
    """The store failed after the reply was decided, so the reply stands: the placement logs `reason` with `cause`
    and tells the unexpected-error listener."""

    reason: str
    cause: Exception


type IdempotencyStart = IdempotencyClaimed | IdempotencyReplayed | None


async def begin_idempotency(
    contract: ApiContract,
    operation_id: str,
    principal: object | None,
    decoded: DecodedInput,
    store: IdempotencyStore | None,
    call: HookCaller,
) -> IdempotencyStart:
    """Claims the request's key. None for a request without a key, or an operation whose idempotency the boundary
    does not enforce; a required key that is missing was refused by the input step.

    Raises `ContractRefusal` when the key is running or was used with another request, and `BoundaryFailureError`
    when the api has no store or the store answers something else."""
    idempotency = ir_map(contract.operation(operation_id), "idempotency")

    if ir_string(idempotency, "kind") != _DERIVED or ir_string(idempotency, "enforce") != _BOUNDARY:
        return None

    client_key = decoded.headers.get(ir_string(idempotency, "header") or "")

    if not isinstance(client_key, str):
        return None

    if store is None:
        raise BoundaryFailureError(
            f"seampact: the api '{contract.api}' has no idempotency store for operation '{operation_id}'; register "
            "one as the target's guide says."
        )

    key = idempotency_partition_key(contract, operation_id, principal, client_key)
    claim = IdempotencyClaim(
        key=key,
        fingerprint=idempotency_fingerprint(contract, operation_id, decoded),
        lifetime_ms=ir_int(idempotency, "lifetimeMs") or 0,
        operation=OperationRef(api=contract.api, id=operation_id),
    )
    begun = await call(store.begin, claim)

    if isinstance(begun, idempotency_begin.Started):
        return IdempotencyClaimed(key)

    if isinstance(begun, idempotency_begin.Running):
        raise role_refusal(contract, operation_id, IN_PROGRESS_ROLE)

    if isinstance(begun, idempotency_begin.Mismatch):
        raise role_refusal(contract, operation_id, KEY_REUSED_ROLE)

    if isinstance(begun, idempotency_begin.Replay):
        return IdempotencyReplayed(_replayed(begun.response, ir_string(idempotency, "replayHeader")))

    raise BoundaryFailureError(
        f"seampact: the idempotency store answered a {type(begun).__qualname__}, none of Started, Running, Mismatch "
        "and Replay; return one of them."
    )


async def settle_idempotency(
    contract: ApiContract,
    operation_id: str,
    claimed: IdempotencyClaimed,
    reply: Reply,
    store: IdempotencyStore,
    call: HookCaller,
) -> IdempotencyStoreFailure | None:
    """Completes the claimed record with the reply that went out, or abandons it when the reply is not kept."""
    try:
        if not _is_kept_for_replay(reply):
            await call(store.abandon, claimed.key)
            return None

        stored = StoredResponse(
            status=reply.status, headers=_stored_headers(contract, operation_id, reply), body=reply.body
        )
        await call(lambda response: store.complete(claimed.key, response), stored)
    except Exception as failure:  # The reply stands: the failure goes back to the placement.
        return IdempotencyStoreFailure(
            "the idempotency store failed to record the reply, so a retry with the same key may run again; check "
            "the store's backend",
            failure,
        )

    return None


async def abandon_idempotency(
    claimed: IdempotencyClaimed, store: IdempotencyStore, call: HookCaller
) -> IdempotencyStoreFailure | None:
    """Releases the key without a reply to keep, after the request failed before its reply."""
    try:
        await call(store.abandon, claimed.key)
    except Exception as failure:  # The request already failed: the failure goes back to the placement.
        return IdempotencyStoreFailure(
            "the idempotency store failed to release a key after the request failed, so a retry waits for its "
            "lifetime; check the store's backend",
            failure,
        )

    return None


def idempotency_partition_key(
    contract: ApiContract, operation_id: str, principal: object | None, client_key: str
) -> str:
    """The stored key of a client key: the api, operation, identity and principal members partition it, so two
    callers never share a record (ADR 0012)."""
    members = principal_members(contract, operation_id, principal)
    identity = ir_string(ir_map(contract.operation(operation_id), "access"), "identity") or ""

    return hex_of([contract.api, operation_id, identity, "" if members is None else hex_of([members]), client_key])


def idempotency_fingerprint(contract: ApiContract, operation_id: str, decoded: DecodedInput) -> str:
    """The digest a retry under the same key must match: the method, the contract path and the decoded input, its
    headers cut to the header params the author declared and a union tag, in lower case. Any other header param the
    compiler derives (a trace id, a deadline, the key, CSRF) and every credential header change on a retry."""
    operation = contract.operation(operation_id)
    credentials = _credential_headers(contract, operation)
    counted = [name for name in _fingerprint_headers(operation) if name not in credentials]
    headers = {name.lower(): value for name, value in decoded.headers.items() if name.lower() in counted}
    parts: dict[str, object] = {"path": decoded.path, "query": decoded.query, "headers": headers}

    if ir_map(operation, "input"):
        parts["body"] = decoded.body

    return hex_of([(ir_string(operation, "method") or "").lower(), ir_string(operation, "path") or "", parts])


def _replayed(stored: StoredResponse, replay_header: str | None) -> Reply:
    """The stored reply as it went out, authored by the boundary; a stored success carries the replay header."""
    replay_name = None if replay_header is None else replay_header.lower()
    headers = [(header.name.lower(), header.value) for header in stored.headers if header.name.lower() != replay_name]

    if replay_name is not None and stored.status < _CLIENT_ERROR_FLOOR:
        headers.append((replay_name, _REPLAYED))

    return Reply(stored.status, tuple(headers), stored.body)


def _is_kept_for_replay(reply: Reply) -> bool:
    """A server error is dropped, and so is an error reply its sender marked no-store; a no-store success is kept,
    so a retry never runs the write twice."""
    if reply.status >= _SERVER_ERROR_FLOOR:
        return False

    if reply.status < _CLIENT_ERROR_FLOOR:
        return True

    directives = [
        directive.strip().lower()
        for name, value in reply.headers
        if name == CACHE_CONTROL
        for directive in value.split(",")
    ]

    return NO_STORE not in directives


def _stored_headers(contract: ApiContract, operation_id: str, reply: Reply) -> tuple[StoredResponse.Header, ...]:
    """The contract reply only: its content headers and the headers the operation declares for its status. Headers
    set beside it (session cookies, CORS, security headers) belong to the request that ran."""
    declared = {
        (ir_string(header, "name") or "").lower()
        for response in ir_maps(contract.operation(operation_id), "responses")
        if ir_int(response, "status") == reply.status
        for header in ir_maps(response, "headers")
    }

    return tuple(
        StoredResponse.Header(name=name, value=value)
        for name, value in reply.headers
        if name == CONTENT_TYPE or name.startswith(_CONTENT_HEADER_PREFIX) or name in declared
    )


def _fingerprint_headers(operation: IrMap) -> list[str]:
    """The header params a retry repeats: those the author declared, and a union tag."""
    names: list[str] = []

    for param in ir_maps(ir_map(operation, "params"), "header"):
        derived_from = ir_map(param, "derivedFrom")

        if not derived_from or ir_string(derived_from, "derivation") == _UNION_TAG_DERIVATION:
            names.append((ir_string(param, "name") or "").lower())

    return names


def _credential_headers(contract: ApiContract, operation: IrMap) -> list[str]:
    """The headers carrying a credential, lower case: a retry after a token or session refresh is the same request."""
    access = ir_map(operation, "access")
    names: list[str] = []

    for scheme_id in ir_strings(access, "schemes"):
        scheme = contract.declaration("schemes", scheme_id)
        kind = ir_string(scheme, "kind")

        if kind == "bearer":
            names.append(_AUTHORIZATION_HEADER)
        elif kind == "header":
            names.append((ir_string(scheme, "name") or "").lower())

    signed = ir_string(contract.declaration("identities", ir_string(access, "identity") or ""), "signed")

    if signed is not None:
        names.append((ir_string(contract.declaration("schemes", signed), "name") or "").lower())

    csrf_header = ir_string(ir_map(operation, "csrf"), "header")

    if csrf_header is not None:
        names.append(csrf_header.lower())

    return names

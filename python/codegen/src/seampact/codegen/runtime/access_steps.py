"""Steps 2 to 5 of the check order (ADR 0012 "The check order"), written once as coroutines for every Python
placement: authenticate with the identity's hook (and the CSRF header a cookie-only credential needs, or the signature
a signed route carries over its raw body, ADR 0013), resolve the
scopes outermost first, then ask the deciders for each requirement in declared order, a rule's proof read from the
body first. Each refusal is one of the operation's declared codes; a hook that answers a code the operation does not
declare, or a missing hook, is a failure of the boundary, answered with the api's 500."""

import copy
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import ClassVar, Final, Protocol

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.digests import hex_of
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.input_decoding import Issue, role_refusal, schema_invalid
from seampact.codegen.runtime.ir_view import IrMap, ir_int, ir_map, ir_maps, ir_string, ir_strings
from seampact.codegen.runtime.principal_members import principal_members
from seampact.codegen.runtime.signature_header import parsed_signature_header
from seampact.codegen.runtime.wire_values import decoded_segment, path_value, scalar_issue
from seampact.hooks import (
    AuthenticateHook,
    AuthenticateRequest,
    DecideHook,
    ErrorCodeWithParams,
    OperationRef,
    RequestView,
    RequirementKind,
    RequirementRequest,
    ResolvedScope,
    ResolveScopeHook,
    ResolveScopeRequest,
    SignatureEncoding,
    SignatureTemplate,
    SignedTemplateRequest,
    SubjectRef,
    ThrottleBucket,
    authenticate_result,
    decision,
    purpose,
    scope_id_source,
    scope_resolution,
)
from seampact.hooks._redaction import RedactedRepr

UNAUTHENTICATED_ROLE: Final = "unauthenticated"
CSRF_INVALID_ROLE: Final = "csrfInvalid"

_BEARER_PREFIX: Final = "bearer "
_OPTIONAL_ACCESS: Final = "optional"
_ANONYMOUS: Final = "anonymous"
_COOKIE: Final = "cookie"
_HEADER: Final = "header"
_BEARER: Final = "bearer"
_RULE: Final = "rule"
_SIGNATURE: Final = "signature"


class HookCaller(Protocol):
    """How a placement calls a hook method: FastAPI awaits an `async def` and runs a `def` in its threadpool; a sync
    placement refuses a suspension."""

    def __call__[A, T](self, method: Callable[[A], T | Awaitable[T]], argument: A, /) -> Awaitable[T]: ...


@dataclass(frozen=True, slots=True)
class CredentialsType:
    """The generated credentials class of one identity and its attribute per scheme id: the authenticate hook receives
    an instance, each scheme's value None when the request does not present it."""

    build: Callable[..., object]
    attributes: Mapping[str, str]

    def of(self, found: Mapping[str, str]) -> object:
        return self.build(**{attribute: found.get(scheme) for scheme, attribute in self.attributes.items()})


@dataclass(frozen=True, slots=True, kw_only=True)
class AccessHooks:
    """The hooks one request may call, keyed by the contract's names; a placement builds them per request."""

    authenticate: Mapping[str, AuthenticateHook]
    deciders: Mapping[str, DecideHook]
    scope_resolvers: Mapping[str, ResolveScopeHook]


@dataclass(slots=True, kw_only=True, repr=False)
class AccessState(RedactedRepr):
    """What steps 2 to 5 read of one contract request and what they leave for the handler: `raw_parameters` the raw
    path segments by parameter name, `body` the decoded tree, `raw_body` the bytes as received on a signed route,
    `credentials_types` the generated credentials class of each identity, `principal` and `scopes` set as the steps
    admit. `repr` shows none of the request's values."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset(
        {"raw_parameters", "body", "raw_body", "principal", "scopes"}
    )

    contract: ApiContract
    operation_id: str
    credentials_types: Mapping[str, CredentialsType]
    raw_parameters: Mapping[str, str]
    request: RequestView
    body: object
    raw_body: bytes | None = None
    principal: object | None = None
    scopes: list[ResolvedScope] = field(default_factory=list)

    @property
    def operation(self) -> OperationRef:
        return OperationRef(api=self.contract.api, id=self.operation_id)


async def run_access_steps(state: AccessState, hooks: AccessHooks, call: HookCaller) -> None:
    """Raises `ContractRefusal` with the operation's code, or `BoundaryFailureError` for a missing hook or an
    undeclared answer."""
    await _authenticate(state, hooks, call)
    await _resolve_scopes(state, hooks, call)
    await _decide_requirements(state, hooks, call)


def refusal_of(state: AccessState, denial: ErrorCodeWithParams) -> ContractRefusal:
    """The refusal of a hook's denial, whose code the operation must declare."""
    if not state.contract.declares(state.operation_id, denial.code):
        raise BoundaryFailureError(
            f"seampact: a hook denied operation '{state.operation_id}' with '{denial.code}', which the operation does "
            "not declare; answer one of its declared codes."
        )

    params = None if denial.params is None else dict(denial.params)

    return ContractRefusal(state.contract.api, denial.code, params)


def headers_view(raw_headers: list[tuple[bytes, bytes]]) -> dict[str, tuple[str, ...]]:
    """Every header by lower-case name, with its values in order, as `RequestView` holds them."""
    headers: dict[str, list[str]] = {}

    for name, value in raw_headers:
        headers.setdefault(name.decode("latin-1").lower(), []).append(value.decode("latin-1"))

    return {name: tuple(values) for name, values in headers.items()}


async def _authenticate(state: AccessState, hooks: AccessHooks, call: HookCaller) -> None:
    operation = state.contract.operation(state.operation_id)
    access = ir_map(operation, "access")
    identity = ir_string(access, "identity")

    if identity is None:
        return

    optional = ir_string(access, "kind") == _OPTIONAL_ACCESS
    credentials, only_cookies = _credentials(state, access)

    if not credentials:
        if optional:
            return

        raise role_refusal(state.contract, state.operation_id, UNAUTHENTICATED_ROLE)

    csrf_header = ir_string(ir_map(operation, "csrf"), "header")
    csrf_token = None if csrf_header is None else _first(state.request, csrf_header)

    if csrf_header is not None and only_cookies and not csrf_token:
        raise role_refusal(state.contract, state.operation_id, CSRF_INVALID_ROLE)

    signed_scheme = ir_string(state.contract.declaration("identities", identity), "signed")
    signature = None if signed_scheme is None else _signed_request(state, signed_scheme, credentials.get(signed_scheme))
    hook = hooks.authenticate.get(identity)

    if hook is None:
        raise BoundaryFailureError(
            f"seampact: the api '{state.contract.api}' has no authenticate hook for the identity '{identity}'; "
            "register one as the target's guide says."
        )

    credentials_type = state.credentials_types.get(identity)

    if credentials_type is None:
        raise BoundaryFailureError(
            f"seampact: the api '{state.contract.api}' has no credentials class for the identity '{identity}'; "
            "run seampact generate again."
        )

    request = AuthenticateRequest(
        identity=identity,
        credentials=credentials_type.of(credentials),
        csrf_token=csrf_token,
        signature=signature,
        request=state.request,
        operation=state.operation,
        extensions=extensions_of(state.contract.declaration("identities", identity)),
    )
    result = await call(hook.authenticate, request)

    if isinstance(result, authenticate_result.Authenticated):
        state.principal = result.principal
        return

    if not isinstance(result, authenticate_result.Denied):
        raise _neither(f"the authenticate hook of '{identity}'", "Authenticated", "Denied", result)

    if optional and ir_string(access, "onRefused") == _ANONYMOUS:
        return

    raise refusal_of(state, result.deny)


def _signed_request(state: AccessState, scheme_id: str, header: str | None) -> SignedTemplateRequest:
    """A signed route's signature, parsed from its header over the raw body the input step kept; a missing or
    malformed header is the unauthenticated refusal, and the identity's hook verifies the signature (ADR 0013)."""
    signature = ir_map(state.contract.declaration("schemes", scheme_id), _SIGNATURE)
    parsed = parsed_signature_header(ir_string(signature, "format") or "", header)

    if parsed is None:
        raise role_refusal(state.contract, state.operation_id, UNAUTHENTICATED_ROLE)

    encoding = ir_string(signature, "encoding")

    if encoding not in tuple(SignatureEncoding):
        raise BoundaryFailureError(
            f"seampact: the signature scheme '{scheme_id}' names the encoding {encoding!r}, which this seampact "
            "release does not read; regenerate the api."
        )

    template = SignatureTemplate(
        algorithm=ir_string(signature, "algorithm") or "",
        payload=ir_string(signature, "payload") or "",
        encoding=SignatureEncoding(encoding),
        tolerance_ms=ir_int(signature, "toleranceMs"),
    )

    return SignedTemplateRequest(
        raw_body=state.raw_body or b"",
        timestamp=parsed.timestamp,
        candidate_signatures=parsed.candidate_signatures,
        key_id=ir_string(ir_map(signature, "key"), "value") or "",
        template=template,
    )


def _credentials(state: AccessState, access: IrMap) -> tuple[dict[str, str], bool]:
    """Each credential the operation's schemes find, by scheme id, and whether every one found is a cookie."""
    credentials: dict[str, str] = {}
    only_cookies = True

    for scheme_id in ir_strings(access, "schemes"):
        scheme = state.contract.declaration("schemes", scheme_id)
        kind = ir_string(scheme, "kind")
        name = ir_string(scheme, "name") or ""

        if kind == _BEARER:
            value = _bearer_token(state.request)
        elif kind == _COOKIE:
            value = _cookie(state.request, name)
        elif kind in (_HEADER, _SIGNATURE):
            value = _first(state.request, name)
        else:
            raise BoundaryFailureError(
                f"seampact: the credential scheme kind {kind!r} of '{scheme_id}' is not one this seampact release "
                "reads; leave the operation out with the entry's `operations` filter."
            )

        if not value:
            continue

        credentials[scheme_id] = value

        if kind != _COOKIE:
            only_cookies = False

    return credentials, only_cookies


def _first(request: RequestView, name: str) -> str | None:
    values = request.headers.get(name.lower(), ())

    return values[0] if values else None


def _bearer_token(request: RequestView) -> str | None:
    authorization = _first(request, "authorization") or ""

    if not authorization.lower().startswith(_BEARER_PREFIX):
        return None

    return authorization[len(_BEARER_PREFIX) :].strip() or None


def _cookie(request: RequestView, name: str) -> str | None:
    for header in request.headers.get(_COOKIE, ()):
        for pair in header.split(";"):
            key, separator, value = pair.strip().partition("=")

            if separator and key == name:
                return value

    return None


async def _resolve_scopes(state: AccessState, hooks: AccessHooks, call: HookCaller) -> None:
    operation = state.contract.operation(state.operation_id)

    for entry in ir_maps(operation, "scopes"):
        scope = ir_string(entry, "scope") or ""
        declared = state.contract.declaration("scopes", scope)
        source_name = ir_string(ir_map(entry, "source"), "name") or ""
        scope_id = _checked_path_value(state, source_name, ir_map(declared, "idSchema"))
        resolver = hooks.scope_resolvers.get(scope)

        if resolver is None:
            raise BoundaryFailureError(
                f"seampact: the api '{state.contract.api}' has no scope resolver for the scope '{scope}'; register one "
                "as the target's guide says."
            )

        request = ResolveScopeRequest(
            scope=scope,
            source=scope_id_source.Declared(id=scope_id),
            principal=state.principal,
            outer_scopes=tuple(state.scopes),
            extensions=ResolveScopeRequest.Extensions(
                scope=extensions_of(declared), operation=extensions_of(operation)
            ),
        )
        resolution = await call(resolver.resolve_scope, request)

        if isinstance(resolution, scope_resolution.Denied):
            raise refusal_of(state, resolution.deny)

        if not isinstance(resolution, scope_resolution.Resolved):
            raise _neither(f"the scope resolver of '{scope}'", "Resolved", "Denied", resolution)

        if resolution.resolved.scope != scope:
            raise BoundaryFailureError(
                f"seampact: the scope resolver of '{scope}' answered the scope '{resolution.resolved.scope}'; return a "
                f"ResolvedScope named '{scope}'."
            )

        state.scopes.append(resolution.resolved)


async def _decide_requirements(state: AccessState, hooks: AccessHooks, call: HookCaller) -> None:
    operation = state.contract.operation(state.operation_id)

    for requirement in ir_maps(operation, "requires"):
        is_rule = ir_string(requirement, "kind") == _RULE
        name = ir_string(requirement, _RULE if is_rule else "right") or ""
        params = requirement.get("params")
        request = RequirementRequest(
            kind=RequirementKind.RULE if is_rule else RequirementKind.RIGHT,
            name=name,
            params=copy.deepcopy(dict(params)) if isinstance(params, Mapping) else None,
            principal=state.principal,
            subject=subject_of(state, ir_map(requirement, "subject"), name),
            scopes=tuple(state.scopes),
            proof=_proof(state, name) if is_rule else None,
            bucket=_throttle_bucket(state, ir_string(requirement, "bucket")),
            purpose=purpose.Route(),
            operation=state.operation,
            request=state.request,
            extensions=RequirementRequest.Extensions(
                requirement=extensions_of(requirement), operation=extensions_of(operation)
            ),
        )
        answer = await decided(hooks, call, request)

        if isinstance(answer, decision.Denied):
            raise refusal_of(state, answer.deny)


async def decided(hooks: AccessHooks, call: HookCaller, request: RequirementRequest) -> decision.Decision:
    """The decider's answer to `request`; a missing decider or an answer that is neither class fails the boundary."""
    decider = hooks.deciders.get(request.name)

    if decider is None:
        raise BoundaryFailureError(
            f"seampact: the api '{request.operation.api}' has no decider for '{request.name}'; register one as the "
            "target's guide says."
        )

    answer = await call(decider.decide, request)

    if not isinstance(answer, decision.Allowed | decision.Denied):
        raise _neither(f"the decider of '{request.name}'", "Allowed", "Denied", answer)

    return answer


def subject_type(contract: ApiContract, right: str) -> str:
    """The subject type a right declares: its scope, or its schema type's dotted name."""
    declared = ir_map(contract.declaration("rights", right), "subject")

    return ir_string(declared, "scope") or ".".join(ir_strings(ir_map(declared, "type"), "segments"))


def subject_of(state: AccessState, subject: IrMap, right: str) -> SubjectRef | None:
    source = ir_map(subject, "source")

    if not source:
        return None

    source_name = ir_string(source, "name") or ""

    if ir_string(source, "in") == "scope":
        resolved = next((scope for scope in state.scopes if scope.scope == source_name), None)

        return None if resolved is None else SubjectRef(type=source_name, id=resolved.id)

    declared = ir_map(state.contract.declaration("rights", right), "subject")

    return SubjectRef(
        type=subject_type(state.contract, right),
        id=_checked_path_value(state, source_name, ir_map(declared, "idSchema")),
    )


def _proof(state: AccessState, rule: str) -> object:
    """The body member a rule reads its proof from, checked first: an issue there is the `schemaInvalid` refusal
    before the decider runs. A body that is absent or not an object gives no proof; step 6 refuses it."""
    proof = ir_map(state.contract.declaration("rules", rule), "proof")
    name = ir_string(proof, "name")

    if name is None or not isinstance(state.body, dict):
        return None

    if name not in state.body:
        raise schema_invalid(state.contract, state.operation_id, [Issue("body", f"/{name}", "required")])

    value: object = state.body[name]
    rule_name = scalar_issue(ir_map(proof, "schema"), value)

    if rule_name is not None:
        raise schema_invalid(state.contract, state.operation_id, [Issue("body", f"/{name}", rule_name)])

    return value


def _throttle_bucket(state: AccessState, bucket_id: str | None) -> ThrottleBucket | None:
    """The bucket a throttle rule counts in: its key is the SHA-256 hex of `[api, bucket, values]` as every target
    writes it, so a counter shared across targets counts one client once."""
    if bucket_id is None:
        return None

    bucket = state.contract.declaration("buckets", bucket_id)
    values = tuple(_bucket_key_value(state, source) for source in ir_maps(bucket, "key"))

    return ThrottleBucket(
        id=bucket_id,
        key=hex_of([state.contract.api, bucket_id, list(values)]),
        values=values,
        limit=ir_int(bucket, "limit"),
        window_ms=ir_int(bucket, "windowMs"),
    )


def _bucket_key_value(state: AccessState, source: IrMap) -> object:
    name = ir_string(source, "name") or ""
    where = ir_string(source, "in")

    if where == "path":
        params = ir_maps(ir_map(state.contract.operation(state.operation_id), "params"), "path")
        declared = next((param for param in params if ir_string(param, "name") == name), None)

        if declared is None:
            raise BoundaryFailureError(
                f"seampact: a bucket of operation '{state.operation_id}' reads the path param '{name}', which the "
                "operation does not declare; regenerate the api."
            )

        return _checked_path_value(state, name, ir_map(declared, "type"))

    if where == "scope":
        return next((scope.id for scope in state.scopes if scope.scope == name), None)

    if where == "principal":
        return _principal_member(state, name)

    raise BoundaryFailureError(f"seampact: a bucket key read from {where!r} is not one the boundary reads.")


def _principal_member(state: AccessState, wire_name: str) -> object:
    """A principal member by its wire name, read through the principal schema's member table."""
    members = principal_members(state.contract, state.operation_id, state.principal)

    if members is None:
        return None

    if wire_name not in members:
        raise BoundaryFailureError(
            f"seampact: a bucket of operation '{state.operation_id}' is keyed by the principal member '{wire_name}', "
            "which the identity's principal does not declare; regenerate the api."
        )

    return members[wire_name]


def _checked_path_value(state: AccessState, name: str, type_use: IrMap) -> object:
    """A path parameter that a scope, a subject or a bucket reads: decoded and checked by its type before any hook
    sees it."""
    raw = state.raw_parameters.get(name, "")
    value = path_value(raw, type_use)
    rule_name = "type" if decoded_segment(raw) is None else scalar_issue(type_use, value)

    if rule_name is not None:
        raise schema_invalid(state.contract, state.operation_id, [Issue("path", f"/{name}", rule_name)])

    return value


def _neither(hook: str, admitted: str, denied: str, answer: object) -> BoundaryFailureError:
    return BoundaryFailureError(
        f"seampact: {hook} answered a {type(answer).__qualname__}, neither {admitted} nor {denied}; return one of them."
    )


def extensions_of(declaration: IrMap) -> Mapping[str, object]:
    """A deep copy: a hook that changes what it got never changes the contract later requests read."""
    return copy.deepcopy(dict(ir_map(declaration, "extensions")))

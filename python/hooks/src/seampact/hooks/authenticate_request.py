"""What the authenticate hook gets: the identity, its credentials and the request; credentials never show."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar

from seampact.hooks._redaction import RedactedRepr
from seampact.hooks.operation_ref import OperationRef
from seampact.hooks.request_view import RequestView
from seampact.hooks.signed_request import SignedRequest


@dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class AuthenticateRequest(RedactedRepr):
    """`credentials` holds what the identity's schemes found in the request; `signature` is set for a signed one."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"credentials", "csrf_token"})

    identity: str
    credentials: object
    csrf_token: str | None = None
    signature: SignedRequest | None = None
    request: RequestView
    operation: OperationRef
    extensions: Mapping[str, object]

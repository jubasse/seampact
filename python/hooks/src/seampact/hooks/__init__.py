"""The hook protocols an app implements and the values they exchange, with the shape every hooks package shares.

A union's arms live in the union's module: `seampact.hooks.decision.Allowed`, `seampact.hooks.purpose.Field`.
"""

from seampact.hooks.authenticate_hook import AuthenticateHook
from seampact.hooks.authenticate_request import AuthenticateRequest
from seampact.hooks.authenticate_result import AuthenticateResult
from seampact.hooks.decide_hook import DecideHook
from seampact.hooks.decision import Decision
from seampact.hooks.error_code_with_params import ErrorCodeWithParams
from seampact.hooks.field import Absent, Field
from seampact.hooks.field_direction import FieldDirection
from seampact.hooks.idempotency_begin import IdempotencyBegin
from seampact.hooks.idempotency_claim import IdempotencyClaim
from seampact.hooks.idempotency_store import IdempotencyStore
from seampact.hooks.operation_ref import OperationRef
from seampact.hooks.purpose import Purpose
from seampact.hooks.request_view import RequestView
from seampact.hooks.requirement_kind import RequirementKind
from seampact.hooks.requirement_request import RequirementRequest
from seampact.hooks.resolve_scope_hook import ResolveScopeHook
from seampact.hooks.resolve_scope_request import ResolveScopeRequest
from seampact.hooks.resolved_scope import ResolvedScope
from seampact.hooks.scope_id_source import ScopeIdSource
from seampact.hooks.scope_resolution import ScopeResolution
from seampact.hooks.signature_encoding import SignatureEncoding
from seampact.hooks.signature_template import SignatureTemplate
from seampact.hooks.signed_application_request import SignedApplicationRequest
from seampact.hooks.signed_request import SignedRequest
from seampact.hooks.signed_template_request import SignedTemplateRequest
from seampact.hooks.stored_response import StoredResponse
from seampact.hooks.subject_ref import SubjectRef
from seampact.hooks.throttle_bucket import ThrottleBucket
from seampact.hooks.unexpected_error_listener import UnexpectedErrorListener
from seampact.hooks.unexpected_failure import UnexpectedFailure

__all__ = [
    "Absent",
    "AuthenticateHook",
    "AuthenticateRequest",
    "AuthenticateResult",
    "DecideHook",
    "Decision",
    "ErrorCodeWithParams",
    "Field",
    "FieldDirection",
    "IdempotencyBegin",
    "IdempotencyClaim",
    "IdempotencyStore",
    "OperationRef",
    "Purpose",
    "RequestView",
    "RequirementKind",
    "RequirementRequest",
    "ResolveScopeHook",
    "ResolveScopeRequest",
    "ResolvedScope",
    "ScopeIdSource",
    "ScopeResolution",
    "SignatureEncoding",
    "SignatureTemplate",
    "SignedApplicationRequest",
    "SignedRequest",
    "SignedTemplateRequest",
    "StoredResponse",
    "SubjectRef",
    "ThrottleBucket",
    "UnexpectedErrorListener",
    "UnexpectedFailure",
]

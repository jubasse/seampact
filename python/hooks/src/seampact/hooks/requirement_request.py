"""What the decide hook gets: the requirement, the principal, the subject, the scopes and the request."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar

from seampact.hooks._redaction import RedactedRepr
from seampact.hooks.operation_ref import OperationRef
from seampact.hooks.purpose import Purpose
from seampact.hooks.request_view import RequestView
from seampact.hooks.requirement_kind import RequirementKind
from seampact.hooks.resolved_scope import ResolvedScope
from seampact.hooks.subject_ref import SubjectRef
from seampact.hooks.throttle_bucket import ThrottleBucket


@dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class RequirementRequest(RedactedRepr):
    """`params` holds the use site's params as an instance of the right's or rule's generated params class, None when
    it declares none; `scopes` are the resolved scopes, outermost first; `principal` is None for an anonymous request.
    The rule proof is sensitive by construction, so it renders redacted."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"proof"})

    @dataclass(frozen=True, slots=True, kw_only=True)
    class Extensions:
        """The extension values of the requirement and of the operation."""

        requirement: Mapping[str, object]
        operation: Mapping[str, object]

    kind: RequirementKind
    name: str
    params: object | None = None
    principal: object | None
    subject: SubjectRef | None = None
    scopes: tuple[ResolvedScope, ...]
    proof: object | None = None
    bucket: ThrottleBucket | None = None
    purpose: Purpose
    operation: OperationRef
    request: RequestView
    extensions: Extensions

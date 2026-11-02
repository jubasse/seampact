"""The base of the generated contract views (ADR 0027 "DRF"). It fixes what DRF would otherwise read from the app's
defaults: one renderer and no default response header, so DRF adds neither `Allow` nor `Vary: Accept`; a fixed
content negotiation, so `Accept` never answers 406; no parser and no versioning, since the views never read
`request.data`; no authentication, permission or throttle class unless the app names some for the operation's access
kind; no schema. A generated method admits the request, builds the typed request from the `Admission` and replies
with the handler's result."""

from collections.abc import Sequence
from typing import ClassVar, Final, Protocol

from django.http import HttpResponseBase
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.request import Request
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from seampact.codegen.runtime.replies import JSON_MEDIA
from seampact.django.runtime import PlacementUnavailableError
from seampact.drf.runtime.serializers import ContractSerializer
from seampact.hooks import ResolvedScope

_RENDERER: Final = JSONRenderer


class Admission(Protocol):
    """A request the view admitted (the boundary's mark, the chosen route, steps 2 to 5), and what it reads next."""

    def input[I](self, serializer: type[ContractSerializer], input_type: type[I]) -> I:
        """Steps 6 to 8: the decoded input validated by `serializer`, built as `input_type`."""
        ...

    def principal[P](self, principal_type: type[P]) -> P: ...

    def optional_principal[P](self, principal_type: type[P]) -> P | None:
        """The caller, None for an anonymous caller on an optional-auth route."""
        ...

    def scope(self, scope: str) -> ResolvedScope: ...

    def reply(self, result: object) -> HttpResponseBase:
        """The handler's result, or its declared error, written by the boundary's own encoding."""
        ...


class ContractView(APIView):
    api: ClassVar[str]
    renderer_classes: Sequence[type[BaseRenderer]] = (_RENDERER,)
    parser_classes = ()
    versioning_class = None
    schema = None

    @property
    def default_response_headers(self) -> dict[str, str]:
        return {}

    def perform_content_negotiation(self, request: Request, force: bool = False) -> tuple[BaseRenderer, str]:
        return _RENDERER(), JSON_MEDIA

    def get_authenticators(self) -> list[BaseAuthentication]:
        return []

    def get_permissions(self) -> Sequence[BasePermission]:
        return []

    def get_throttles(self) -> list[BaseThrottle]:
        return []

    def admit(self, request: Request, operation_id: str) -> Admission:
        raise PlacementUnavailableError(f"The DRF steps of operation '{operation_id}' of api '{self.api}'")

"""The base of the generated contract views (ADR 0027 "DRF"). It fixes what DRF would otherwise read from the app's
defaults: one renderer and no default response header, so DRF adds neither `Allow` nor `Vary: Accept`; a fixed
content negotiation, so `Accept` never answers 406; one parser, which hands DRF a copy of the body the boundary
decoded, and no versioning; the authentication, permission and throttle classes the app names for the operation's
access kind, and none otherwise, so the app's DRF defaults never apply; no schema. A generated method admits the
request, builds the typed request from the `Admission` and replies with the handler's result."""

from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import ClassVar, Final, Protocol

from django.http import HttpRequest, HttpResponseBase
from rest_framework.authentication import BaseAuthentication
from rest_framework.parsers import BaseParser
from rest_framework.permissions import BasePermission
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.request import Request
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from seampact.codegen.runtime.access_steps import CredentialsType
from seampact.codegen.runtime.contract import NOT_FOUND_ROLE, ApiContract
from seampact.codegen.runtime.replies import JSON_MEDIA, role_reply
from seampact.django.runtime.contract_replies import django_response
from seampact.django.runtime.request_state import state_of
from seampact.drf.runtime.access_classes import (
    AUTHENTICATION_CLASSES,
    PERMISSION_CLASSES,
    THROTTLE_CLASSES,
    access_instances,
)
from seampact.drf.runtime.admission import admit
from seampact.drf.runtime.decoded_body_parser import DecodedBodyParser
from seampact.drf.runtime.serializers import ContractSerializer
from seampact.drf.runtime.session_csrf import csrf_tagged
from seampact.hooks import ResolvedScope

_RENDERER: Final = JSONRenderer
_NOT_FOUND_STATUS: Final = 404


class Admission(Protocol):
    """A request the view admitted (the boundary's mark, the chosen route, steps 2 to 5), and what it reads next."""

    def input[I](self, serializer: type[ContractSerializer], input_type: type[I]) -> I:
        """Steps 6 to 8: the decoded input validated by `serializer`, built as `input_type`."""
        ...

    def empty_input[I](self, input_type: type[I]) -> I:
        """Steps 6 to 8 of an operation without parameters or body: an unknown query key is still refused."""
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
    contract: ClassVar[ApiContract]
    credentials: ClassVar[Mapping[str, CredentialsType]] = MappingProxyType({})
    renderer_classes: Sequence[type[BaseRenderer]] = (_RENDERER,)
    parser_classes: Sequence[type[BaseParser]] = (DecodedBodyParser,)
    versioning_class = None
    schema = None

    @property
    def default_response_headers(self) -> dict[str, str]:
        return {}

    def perform_content_negotiation(self, request: Request, force: bool = False) -> tuple[BaseRenderer, str]:
        return _RENDERER(), JSON_MEDIA

    def get_authenticators(self) -> list[BaseAuthentication]:
        authenticators = self._access_instances(AUTHENTICATION_CLASSES, BaseAuthentication)

        return [csrf_tagged(authenticator) for authenticator in authenticators]

    def get_permissions(self) -> Sequence[BasePermission]:
        return self._access_instances(PERMISSION_CLASSES, BasePermission)

    def get_throttles(self) -> list[BaseThrottle]:
        return self._access_instances(THROTTLE_CLASSES, BaseThrottle)

    # DRF types its handlers as answering a `Response`; the api's own reply is a Django response, as `finalize_response`
    # accepts.
    def options(self, request: Request, *args: object, **kwargs: object) -> HttpResponseBase:  # type: ignore[override]
        """A CORS preflight the boundary left to the app reaches the view when no CORS layer answered it: the path's
        404, as the boundary answers any method the path does not serve, never DRF's metadata."""
        unserved = role_reply(self.contract, None, NOT_FOUND_ROLE, _NOT_FOUND_STATUS)

        return django_response(request._request, self.contract, unserved)

    def admit(self, request: Request, operation_id: str) -> Admission:
        """Raises `BoundaryFailureError` or `ContractRefusal`, which the api's exception handler answers."""
        return admit(request._request, self.contract, self.credentials, operation_id)

    def _access_instances[B](self, name: str, base: type[B]) -> list[B]:
        """The classes of the operation the boundary matched; none without the boundary's mark, since the generated
        method then fails closed before any input is read."""
        request: object = self.request
        http_request = request._request if isinstance(request, Request) else request
        state = state_of(http_request, self.contract.api) if isinstance(http_request, HttpRequest) else None

        if state is None:
            return []

        return access_instances(self.contract, state.operation_id, name, base)

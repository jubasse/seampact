"""The one parser of the contract views (ADR 0027 "DRF"): DRF's `request.data` and `request.POST` are a copy of the
body the boundary decoded, never a second read. The generated methods never read them; the app's authentication and
permission classes may, and DRF's own CSRF check reads `request.POST`, which would otherwise answer 415 on a JSON
body."""

import copy
from collections.abc import Mapping
from typing import Final

from django.http import HttpRequest
from django.utils.datastructures import MultiValueDict
from rest_framework.parsers import BaseParser, DataAndFiles
from rest_framework.request import Request

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.django.runtime.request_state import state_of

_ANY_MEDIA: Final = "*/*"


class DecodedBodyParser(BaseParser):
    # The stubs' `DataAndFiles` is generic, DRF's class is not: the return annotation stays a string.
    media_type = _ANY_MEDIA

    def parse(
        self, stream: object, media_type: str | None = None, parser_context: Mapping[str, object] | None = None
    ) -> "DataAndFiles[object, MultiValueDict[str, object]]":
        """Raises `BoundaryFailureError` without the boundary's mark, which the api's exception handler answers with
        its 500."""
        context = parser_context or {}
        drf_request, view = context.get("request"), context.get("view")
        contract = getattr(view, "contract", None)
        request = drf_request._request if isinstance(drf_request, Request) else drf_request
        state = (
            state_of(request, contract.api)
            if isinstance(request, HttpRequest) and isinstance(contract, ApiContract)
            else None
        )

        if state is None:
            raise BoundaryFailureError("seampact: DRF parsed the body of a contract view the boundary did not admit.")

        return DataAndFiles(copy.deepcopy(state.decoded.body), MultiValueDict())

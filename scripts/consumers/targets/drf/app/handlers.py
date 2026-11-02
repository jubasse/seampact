"""The developer's handlers of the operations the consumer serves, each answering the loaded script when it says so,
and the factories SEAMPACT names, which build them per request."""

from django.http import HttpRequest
from generated.tasks.operations import (
    GetChannelRequest,
    GetChannelResponse200,
    GetChannelResult,
    GetDraftRequest,
    GetDraftResponse200,
    GetDraftResult,
    HealthRequest,
    HealthResponse200,
    HealthResult,
)
from generated.tasks.schemas import Health
from sample_data import channel_of, draft, loaded_channel
from seampact_consumer_suite.scripted_answers import scripted_answer, text_member

_OK: int = 200
_HEALTHY: str = "ok"


def _health_of(body: dict[str, object]) -> HealthResult:
    return HealthResponse200(body=Health(status=text_member(body, "status")))


def _channel_reply_of(body: dict[str, object]) -> GetChannelResult:
    return GetChannelResponse200(body=channel_of(body))


class AppHandlers:
    def health(self, request: HealthRequest) -> HealthResult:
        return scripted_answer("health", _OK, _health_of) or HealthResponse200(body=Health(status=_HEALTHY))


class ChannelsHandlers:
    def get_channel(self, request: GetChannelRequest) -> GetChannelResult:
        caller_id = str(request.principal.user_id)

        return scripted_answer("getChannel", _OK, _channel_reply_of) or GetChannelResponse200(
            body=loaded_channel(request.scopes.channel, caller_id)
        )


class DraftsHandlers:
    def get_draft(self, request: GetDraftRequest) -> GetDraftResult:
        return GetDraftResponse200(body=draft(request.input.path.draft_id))


def app_handlers(request: HttpRequest) -> AppHandlers:
    return AppHandlers()


def channels_handlers(request: HttpRequest) -> ChannelsHandlers:
    return ChannelsHandlers()


def drafts_handlers(request: HttpRequest) -> DraftsHandlers:
    return DraftsHandlers()

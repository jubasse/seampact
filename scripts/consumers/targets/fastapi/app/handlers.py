"""The developer's handlers of the operations the consumer serves, each answering the loaded script when it says so."""

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
    return HealthResponse200(Health(status=text_member(body, "status")))


def _channel_reply_of(body: dict[str, object]) -> GetChannelResult:
    return GetChannelResponse200(channel_of(body))


class AppHandlers:
    def health(self, request: HealthRequest) -> HealthResult:
        return scripted_answer("health", _OK, _health_of) or HealthResponse200(Health(status=_HEALTHY))


class ChannelsHandlers:
    def get_channel(self, request: GetChannelRequest) -> GetChannelResult:
        caller_id = str(request.principal.user_id)

        return scripted_answer("getChannel", _OK, _channel_reply_of) or GetChannelResponse200(
            loaded_channel(request.scopes.channel, caller_id)
        )


class DraftsHandlers:
    async def get_draft(self, request: GetDraftRequest) -> GetDraftResult:
        return GetDraftResponse200(draft(str(request.input.path.draft_id)))

"""The values the handlers answer without a script, and the scripted bodies read into the generated types."""

from collections.abc import Mapping
from typing import Final

from generated.tasks.schemas import Channel, Draft
from seampact_consumer_suite.scripted_answers import text_member

from seampact.hooks import ResolvedScope

GENERAL_CHANNEL_NAME: Final = "General"
DRAFT_TEXT: Final = "Draft text"


def channel(channel_id: str) -> Channel:
    return Channel.model_validate({"channel_id": channel_id, "name": GENERAL_CHANNEL_NAME})


def channel_of(body: Mapping[str, object]) -> Channel:
    return Channel.model_validate({"channel_id": text_member(body, "channelId"), "name": text_member(body, "name")})


def loaded_channel(scope: ResolvedScope, caller_id: str) -> Channel:
    """The channel the scope resolver loaded, as the handler reads it with its caller's id: the consumer proves the
    principal and the scopes reach the handler without a second lookup."""
    if caller_id == "":
        raise LookupError(f"the handler of scope '{scope.scope}' read no caller id from its principal")

    if not isinstance(scope.value, Channel):
        raise LookupError(f"the resolver of scope '{scope.scope}' loaded no channel for the handler")

    return scope.value


def draft(draft_id: str) -> Draft:
    return Draft.model_validate({"draft_id": draft_id, "body": DRAFT_TEXT})

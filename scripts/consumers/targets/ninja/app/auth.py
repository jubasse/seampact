"""The consumer's own Ninja authentication of the `identity` access kind, which `bind_tasks(access=...)` names: it signs
in the caller of a bearer token of the suite's credentials as Ninja's `request.auth`, and lets any other request
through as an anonymous caller for the `user` hook, which then reads `request.auth`; so the suite fails if a contract
route skipped it."""

from dataclasses import dataclass
from typing import Final

from django.http import HttpRequest
from hook_doubles import TokenUser, user_id_of

_BEARER_PREFIX: Final = "bearer "


@dataclass(frozen=True, slots=True)
class AnonymousCaller:
    """A request without a known bearer token; truthy, so Ninja lets it through to the `user` hook."""


def suite_token_auth(request: HttpRequest) -> TokenUser | AnonymousCaller:
    header = request.headers.get("Authorization", "")

    # The token as the contract's bearer scheme reads it: a case-insensitive scheme, then the trimmed token.
    if not header.lower().startswith(_BEARER_PREFIX):
        return AnonymousCaller()

    token = header[len(_BEARER_PREFIX) :].strip()
    user_id = user_id_of(token)

    return AnonymousCaller() if user_id is None else TokenUser(user_id, token)

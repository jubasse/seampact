"""The authenticate hook's answer: the authenticated principal, or a denial with its declared error."""

from dataclasses import dataclass

from seampact.hooks.error_code_with_params import ErrorCodeWithParams


@dataclass(frozen=True, slots=True, kw_only=True)
class Authenticated:
    principal: object


@dataclass(frozen=True, slots=True, kw_only=True)
class Denied:
    deny: ErrorCodeWithParams


type AuthenticateResult = Authenticated | Denied

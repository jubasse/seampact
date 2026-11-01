"""The template signature verifier an authenticate hook calls for a signed identity (ADR 0013).

HMAC over the raw body, timestamp tolerance and secret rotation; the application keeps its secrets.
"""

from seampact.signed_webhooks.clock import Clock, SystemClock
from seampact.signed_webhooks.placeholders import SUPPORTED_ALGORITHM
from seampact.signed_webhooks.refusals import (
    EmptySignatureSecretError,
    SignaturePayloadInvalidError,
    SignatureToleranceInvalidError,
    UnsupportedSignatureAlgorithmError,
)
from seampact.signed_webhooks.scheme import SignatureEncoding, SignatureScheme
from seampact.signed_webhooks.secret_lookup import SecretLookup
from seampact.signed_webhooks.signed_message import SignedMessage
from seampact.signed_webhooks.verification import SignatureFailure, SignatureVerification
from seampact.signed_webhooks.verifier import TemplateSignatureVerifier

__all__ = [
    "SUPPORTED_ALGORITHM",
    "Clock",
    "EmptySignatureSecretError",
    "SecretLookup",
    "SignatureEncoding",
    "SignatureFailure",
    "SignaturePayloadInvalidError",
    "SignatureScheme",
    "SignatureToleranceInvalidError",
    "SignatureVerification",
    "SignedMessage",
    "SystemClock",
    "TemplateSignatureVerifier",
    "UnsupportedSignatureAlgorithmError",
]

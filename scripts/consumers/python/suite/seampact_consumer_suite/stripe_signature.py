"""The `stripe` identity's check: `seampact-signed-webhooks` verifies the signature over the raw body with the suite's
`stripeSecret`, the one secret of the key id `stripe`."""

from collections.abc import Sequence
from typing import Final

from seampact.hooks import SignedTemplateRequest
from seampact.signed_webhooks import SignatureEncoding, SignatureScheme, SignedMessage, TemplateSignatureVerifier
from seampact_consumer_suite.credentials import credential_text

# The account the verified sender is.
STRIPE_ACCOUNT: Final = "acct_seampact"
_STRIPE_KEY_ID: Final = "stripe"


class _StripeSecrets:
    def secrets_for(self, key_id: str) -> Sequence[str | bytes]:
        return [credential_text("stripeSecret")] if key_id == _STRIPE_KEY_ID else []


def stripe_signature_verified(signed: object) -> bool:
    """False for a request that carries no signed template request."""
    if not isinstance(signed, SignedTemplateRequest):
        return False

    template = signed.template
    scheme = SignatureScheme(
        algorithm=template.algorithm,
        payload=template.payload,
        encoding=SignatureEncoding(template.encoding.value),
        tolerance_ms=template.tolerance_ms,
    )
    message = SignedMessage(
        raw_body=signed.raw_body, timestamp=signed.timestamp, candidate_signatures=signed.candidate_signatures
    )

    return TemplateSignatureVerifier(_StripeSecrets()).verify(message, signed.key_id, scheme).verified

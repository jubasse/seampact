"""The constants of a template signature scheme: the placeholders of its payload and the one algorithm computed."""

from typing import Final

# The only MAC this verifier computes; the IR enum is open, so another algorithm is refused by name.
SUPPORTED_ALGORITHM: Final = "hmac-sha256"

TIMESTAMP_PLACEHOLDER: Final = "{ts}"
RAW_BODY_PLACEHOLDER: Final = "{rawBody}"

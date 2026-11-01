"""The secrets currently valid for a key id: one, or several during a rotation. The verifier never keeps them."""

from collections.abc import Sequence
from typing import Protocol


class SecretLookup(Protocol):
    def secrets_for(self, key_id: str) -> Sequence[str | bytes]:
        """The secrets of the key id, text as UTF-8 or bytes; none when the key id is unknown."""
        ...

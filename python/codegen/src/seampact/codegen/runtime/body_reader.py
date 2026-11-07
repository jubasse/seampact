"""Step 1's bounded body read: a declared `Content-Length` above the route's limit is refused before reading; the
chunks are read as they arrive, `gzip` and `deflate` decoded with `zlib`, and refused as soon as the encoded or the
decoded bytes pass the limit; another content coding is refused, and a corrupt compressed body is the client's."""

import zlib
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Final

PAYLOAD_TOO_LARGE_ROLE: Final = "payloadTooLarge"
UNSUPPORTED_MEDIA_TYPE_ROLE: Final = "unsupportedMediaType"
SCHEMA_INVALID_ROLE: Final = "schemaInvalid"

_IDENTITY_CODINGS: Final = frozenset({"", "identity"})
_WINDOWS: Final = {"gzip": 16 + zlib.MAX_WBITS, "x-gzip": 16 + zlib.MAX_WBITS, "deflate": zlib.MAX_WBITS}


@dataclass(frozen=True, slots=True, repr=False)
class BodyRead:
    """The decoded bytes, or the role of the refusal; `repr` never shows the bytes."""

    data: bytes
    refused_role: str | None = None

    def __repr__(self) -> str:
        return f"BodyRead(data=[redacted], refused_role={self.refused_role!r})"


async def read_body(
    chunks: AsyncIterator[bytes], declared_length: str | None, content_encoding: str | None, limit_bytes: int
) -> BodyRead:
    if declared_length is not None and declared_length.isdigit() and int(declared_length) > limit_bytes:
        return BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)

    coding = (content_encoding or "").strip().lower()

    if coding not in _IDENTITY_CODINGS and coding not in _WINDOWS:
        return BodyRead(b"", UNSUPPORTED_MEDIA_TYPE_ROLE)

    inflater = zlib.decompressobj(_WINDOWS[coding]) if coding in _WINDOWS else None
    received = 0
    data = bytearray()

    async for chunk in chunks:
        received += len(chunk)

        if received > limit_bytes:
            return BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)

        try:
            # One byte past the limit is enough to refuse, so a small bomb never inflates in full.
            decoded = chunk if inflater is None else inflater.decompress(chunk, limit_bytes - len(data) + 1)
        except zlib.error:
            return BodyRead(b"", SCHEMA_INVALID_ROLE)

        data.extend(decoded)

        if len(data) > limit_bytes:
            return BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)

    if inflater is not None and not inflater.eof and received > 0:
        return BodyRead(b"", SCHEMA_INVALID_ROLE)

    return BodyRead(bytes(data))

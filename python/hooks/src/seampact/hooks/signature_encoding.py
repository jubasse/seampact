"""How a signature scheme writes its MAC in the header."""

from enum import StrEnum


class SignatureEncoding(StrEnum):
    HEX = "hex"
    BASE64 = "base64"

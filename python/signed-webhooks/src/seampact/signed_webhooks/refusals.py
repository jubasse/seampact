"""The refusals of the verifier: a scheme or a secret it cannot check safely, each with a stable code."""

from typing import ClassVar, Self

from seampact.signed_webhooks.placeholders import SUPPORTED_ALGORITHM


class UnsupportedSignatureAlgorithmError(ValueError):
    """The scheme names an algorithm this verifier does not compute: a contract it cannot verify."""

    CODE: ClassVar[str] = "signature.algorithm.unsupported"

    def __init__(self, algorithm: str) -> None:
        super().__init__(
            f"The signature algorithm '{algorithm}' is not one seampact-signed-webhooks computes; it computes "
            f"'{SUPPORTED_ALGORITHM}'. Verify this scheme with 'verify: application', or update the package to a "
            "release that computes it."
        )
        self.algorithm = algorithm


class SignaturePayloadInvalidError(ValueError):
    """The signed payload does not hold `{rawBody}` exactly once and `{ts}` at most once."""

    CODE: ClassVar[str] = "signature.payload.invalid"

    def __init__(self, payload: str) -> None:
        super().__init__(
            f"The signed payload '{payload}' must hold {{rawBody}} exactly once and {{ts}} at most once, or a "
            "captured signature could pass with another body. Copy the payload of the hook's signature template."
        )
        self.payload = payload


class SignatureToleranceInvalidError(ValueError):
    """The tolerance does not fit the payload: missing for a `{ts}` payload, negative, or given without `{ts}`."""

    CODE: ClassVar[str] = "signature.tolerance.invalid"

    @classmethod
    def missing(cls, payload: str) -> Self:
        return cls(
            f"The signed payload '{payload}' holds {{ts}} but the scheme has no tolerance, so a replayed request of "
            "any age would pass. Pass the tolerance of the hook's signature template as tolerance_ms."
        )

    @classmethod
    def not_whole_milliseconds(cls, tolerance_ms: object) -> Self:
        return cls(
            f"The tolerance {tolerance_ms!r} ms is not a whole number of milliseconds of at least 0, so the "
            "timestamp check would not hold. Pass the tolerance of the hook's signature template as tolerance_ms."
        )

    @classmethod
    def without_timestamp(cls, payload: str) -> Self:
        return cls(
            f"The scheme has a tolerance but its signed payload '{payload}' holds no {{ts}}, so there is no "
            "timestamp to check. Drop the tolerance, as the hook's signature template does."
        )


class EmptySignatureSecretError(ValueError):
    """The lookup returned an empty secret, or one that is neither text nor bytes: anyone could compute the MAC.

    The message names the key id and the position in the list, never a secret.
    """

    CODE: ClassVar[str] = "signature.secret.empty"

    def __init__(self, key_id: str, index: int) -> None:
        super().__init__(
            f"The secret at position {index} looked up for the key '{key_id}' is empty or neither text nor bytes, so "
            "any request could pass. Configure the secret (check the environment variable behind the lookup)."
        )
        self.key_id = key_id
        self.index = index

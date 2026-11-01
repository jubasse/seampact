"""What a hook sees of the HTTP request; its headers never show in a repr."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar

from seampact.hooks._redaction import RedactedRepr


@dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class RequestView(RedactedRepr):
    """`headers` holds every header by lower-case name, each with its values in order."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"headers"})

    method: str
    path: str
    headers: Mapping[str, tuple[str, ...]]
    client_address: str | None = None

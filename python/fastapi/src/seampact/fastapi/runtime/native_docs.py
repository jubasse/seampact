"""The entry's `frameworkDocs`, which FastAPI's placement carries beside seampact's `nativeDocs` (ADR 0026 "Native
docs")."""

from enum import StrEnum


class FrameworkDocs(StrEnum):
    """The entry's `frameworkDocs`: `keep` leaves FastAPI's documentation routes as the app has them, `off` removes
    them."""

    KEEP = "keep"
    OFF = "off"

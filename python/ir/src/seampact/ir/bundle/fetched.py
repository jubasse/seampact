"""A bundle that passed the pinned-bundle check: its integrity and each api's IR document, by api name."""

from dataclasses import dataclass

from seampact.ir.config.json_value import JsonObject


@dataclass(frozen=True, slots=True)
class FetchedBundle:
    integrity: str
    ir_documents: dict[str, JsonObject]

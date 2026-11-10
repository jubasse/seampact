### Redaction

ADR 0026 "Redaction" holds: dataclasses get a generated `__repr__` and `__rich_repr__`, Pydantic models a generated `__repr_args__`. On DRF, a signed route's input prints its body `[redacted]`, and a handler's request its principal and scopes; a serializer prints none of the data it validates, and a validation error carries a fixed message per rule, never the refused value. The boundary's logs go to the `seampact.<api>` logger.

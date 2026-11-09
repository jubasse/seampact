### Redaction

Every generated class that holds a value of ADR 0023's "Redaction" list (credentials, the CSRF token, an identity's credentials, a signed request's body and signature, a `sensitive` member, who is calling) prints it as `[redacted]`:

- a dataclass gets a generated `__repr__` and `__rich_repr__`;
- a Pydantic model gets a generated `__repr_args__`, which Pydantic's `__repr__`, `__str__` and rich output read;
- raw body bytes live inside an object with a redacted `repr`, never in a bare local.

So `repr`, `str`, `pprint`, `logging` with `%r`, `rich`, and error trackers that capture frame locals by `repr` never show the value. `model_dump`, `dataclasses.asdict` and `json.dumps` still show it; the FastAPI guide says so.

The boundary's own logs go to the `seampact.<api>` logger of Python's `logging`, with the operation id, the rule and the pointer, never an input value. A logged pointer is cut to `MAX_LOGGED_POINTER_BYTES = 256` on a UTF-8 boundary, its control characters escaped.

### 13. What a schema never holds

- Envelope, page or error-body fields: they come from the wire format (A30, ADR 0002 section 13). A handler returns the unwrapped payload; the IR stores it and a reference to the format.
- Validator idioms: no transform, coercion, custom message, async check or library-specific keyword. Query and form decoding (strings to numbers and booleans, lone values to lists) is IR data, not a schema behaviour (FR-30).
- Authorization: a schema names a right through `restrictedTo`; it never decides one.

### Redaction

`toString()` of every generated record and exception is generated, since a record's default `toString()` prints every component (spike). It never shows:

- `AuthenticateRequest.credentials()`;
- `csrfToken()`;
- the members of each identity's generated credentials record;
- a signed request's body, raw and parsed (the `body` of a signed route's input record), and its signature header;
- a `sensitive` member.

An input's `principal` and `scopes` are not wire values and may hold sensitive data: they are left out of its `toString()` and of its Jackson serialization.

Each is printed as the generated `[redacted]` constant, since `seampact-hooks`'s `Redaction` is package-private (ADR 0012 obligations, CHK-168). The boundary's own logs carry the operation id, the rule and the pointer, never an input value.

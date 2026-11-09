### Redaction

Every generated class that holds one of the values below gets a generated `__debugInfo()`, and its constructor marks that parameter `#[\SensitiveParameter]`:

- `AuthenticateRequest`'s credentials;
- the CSRF token;
- the members of each identity's generated credentials class;
- a signed request's body, raw and parsed (the `body` of a signed route's input), and its signature header;
- a `sensitive` member, a principal's among them;
- who is calling, the principal and the scopes, in the boundary state and in a Symfony input (ADR 0024).

Each is printed as the generated `[redacted]` constant, since `seampact/hooks` keeps its redaction internal (ADR 0012 obligations, CHK-168).

- `var_dump` and `print_r` read `__debugInfo()`.
- Stack traces and `getTrace()` arguments omit the `#[\SensitiveParameter]` values (spike).
- Symfony VarDumper, behind Laravel's `dump()` and `dd()`, prints the real properties next to `__debugInfo()` (spike). The provider registers a caster for the generated classes in `AbstractCloner::$defaultCasters`, which hides them there too (spike). Laravel's dumper copied the casters when it was built, so the provider rebuilds it after adding them; a dump handler another package installed earlier (Telescope, a dump server) is kept, not replaced, and hides them only if its cloner was built after the provider booted.
- `var_export`, `json_encode` and an `(array)` cast still show them; the Laravel guide says so.

An opaque value takes any JSON value, `null` only when nullable (ADR 0003 section 2), except a non-finite number (`1e400`, which PHP decodes to `INF`): the boundary refuses it as `type` at its pointer, since `json_encode` cannot write it back and the value would not survive a reply or a replay. The Node target accepts it today; aligning it is tracked outside this ADR. Spring refuses it since the alignment on PHP.

The PHP runtime refuses to write a non-nullable opaque `null` in a reply whatever `bodyValidation` or `responses: warn` say (it fails closed).

The boundary's own logs, written to the app's PSR-3 logger, carry the operation id, the rule and the pointer, never an input value. A pointer can hold client text (an unknown key's name), so a logged pointer is cut to `MAX_LOGGED_POINTER_BYTES = 256` on a UTF-8 boundary, with its control characters escaped.

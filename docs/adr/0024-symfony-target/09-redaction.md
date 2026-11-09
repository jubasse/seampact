### Redaction

Every generated class that holds one of the values below gets a generated `__debugInfo()`, and its constructor marks that parameter `#[\SensitiveParameter]`:

- `AuthenticateRequest`'s credentials;
- the CSRF token;
- the members of each identity's generated credentials class;
- a signed request's body, raw and parsed, and its signature header;
- a `sensitive` member.

Each is printed as the generated `[redacted]` constant (ADR 0012 obligations, CHK-168).

- `var_dump` and `print_r` read `__debugInfo()`; stack traces omit the `#[\SensitiveParameter]` values.
- Symfony VarDumper, behind `dump()`, `dd()` and the profiler's request panel, which dumps the request attributes holding the typed input, prints the real properties next to `__debugInfo()`. The bundle's `boot()` registers a caster for every generated value class and runtime holder (each identity's credentials class and the hook calls that hold credentials included) in `AbstractCloner::$defaultCasters`, which dumps the object's `__debugInfo()` and so hides them there, as on Laravel.
- `var_export`, `json_encode` and an `(array)` cast still show them; the Symfony guide says so.

The boundary's own logs, written to the app's PSR-3 logger, carry the operation id, the rule and the pointer, never an input value or a Symfony violation message. A logged pointer is cut to `MAX_LOGGED_POINTER_BYTES = 256` on a UTF-8 boundary, with its control characters escaped.

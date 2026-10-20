# Access and error code errors

Codes that start with `seampact/access/` and `seampact/derive/`.

| You see | Do |
|---|---|
| `seampact/access/deny-by-default` | A route has no identity and no public access. Set `identity: <name>`, or `access: { public: "<reason>" }`, on the route or a node above it. |
| `seampact/access/identity-reference` | The identity is not declared. Declare it under `identities`, or fix the name. |
| `seampact/access/requirement-entry` | A name in `requires` is not in `requirements`. Declare it, or write `{ right: ... }`. |
| `seampact/access/right-pattern` | A right does not match `conventions.rights.pattern`. Rename the right, or change the pattern. |
| `seampact/access/scheme-reference` | An identity names a scheme that is not declared. Declare it under `schemes`, or fix the name. |
| `seampact/derive/error-unknown` | A route attaches a code nobody declares. Declare it under `errors` with a `status`, or attach a declared one. |
| `seampact/derive/error-redefined` | A code is declared again with a different definition. Where you reuse it, attach it with `{}`, or give one of them another code. |
| `seampact/derive/error-pattern` | A code does not match `conventions.errors.pattern`. Rename the code, or change the pattern. |
| `seampact/derive/cache-sensitive` | A cache family would store a sensitive value that its routes answer. Drop `cache` or `sensitive`, or write `freshness: never`. |

See [Access](../contract/04-access.md) and [Errors](../contract/03-errors.md).

### 4. Scalars, names and value sources

- Durations: an integer followed by `ms`, `s`, `m`, `h` or `d` (`300ms`, `15m`, `24h`). Sizes: an integer followed by `B`, `KiB` or `MiB` (`1MiB`). Dates: a quoted ISO 8601 date (`'2027-06-30'`); unquoted it is a YAML 1.1 timestamp and refused.
- Reasons: a non-empty string. A reason is required on every safety exception, and only there (A40): `access.public`, `access.optionalAuth`, a right's `guest`, `csrf.exempt`, `idempotency.exempt`, an `unknownKeys` or `unknownQuery` that does not refuse, an opaque value, and, in the app config, a framework route outside the contract and native access (ADR 0011). A departure from a default that weakens no check (no path version, another format, an unpaged list, a stated maturity, a local enum or a narrowing) takes no reason, and may carry one as docs where the keyword offers it.
- Name patterns, checked by the authoring schema:

| Element | Pattern | Examples |
|---|---|---|
| schemas, enums | `^[A-Z][A-Za-z0-9]*$` | `Task`, `TaskId` |
| apis, surfaces, tree nodes, operation ids, identities, schemes, headers, scopes, rules, requirements, buckets, services, natures, wire formats, paging styles, pack entries, cache families, documents | `^[a-z][A-Za-z0-9_]*$` | `tasks`, `viewer_or_device`, `five_minutes` |
| scalars (named formats) | `^[a-z][A-Za-z0-9]*(-[a-z0-9]+)*$` | `money`, `iri-reference` |
| rights | any non-empty string without control characters and without leading or trailing space | `roles`, `tasks.update`, `read:tasks`, `update-post`, `ROLE_ADMIN`, `edit articles` |
| error codes | `^[A-Za-z0-9][A-Za-z0-9._-]*$` | `api.forbidden`, `state.conflict`, `TASK_NOT_FOUND`, `E1042`, `not-found` |
| extension prefixes | `^[a-z][a-z0-9]*$`, `seampact` reserved | `acme` |
| extension keys | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` | `tax-basis`, `invalidates` |

  Right names and error codes are wire and library values, so the core asks no more of them than it must (A20, A36). A right takes the name the application's library already uses: an OAuth scope, a Laravel Gate, a Spring authority, a spatie permission; a name holding a space or a `:` followed by a space is quoted in YAML. An error code is the value every format sends and also the name of its OpenAPI component, whose keys OpenAPI 3.1 limits to letters, digits, `.`, `-` and `_`: hence its alphabet. A URI-shaped problem `type` is a format template over the code (section 15), not a code. The core imposes no naming convention on either (SCN-063); `conventions.rights.pattern` and `conventions.errors.pattern` add one when a contract or a pack wants it (section 13). Two rights or two codes whose identifier segments are equal (`not-found` and `not_found`) are a compile error, as for any name (ADR 0007), and a right whose name yields no identifier segment (`'*'`) needs a `codeName` (section 9); its name on the wire and in the hooks stays as written. An error's family is its `family` key, or else its code up to the first dot; a code without a dot and without `family` has none (FR-6).
- A fields map maps names to schemas. A field is required unless its name ends with `?`: `query: { limit?: { type: integer }, cursor?: Cursor }`. A fields map has no `required` keyword and a schema has no `?` suffix, so each place has one way to say it. Fields maps are used for `id`, `pathParams`, `query`, `headers`, and the `params` of errors, rights and rules. In each of these places a string instead of a mapping names a schema whose properties are the fields (`query: TaskQuery`).
- Value sources name where a value is read. One grammar serves every use; each use accepts a subset:

| Source | Meaning |
|---|---|
| `path.<param>` | a path parameter |
| `query.<param>` | a query parameter |
| `header.<Name>` | a request header (case-insensitive) |
| `body.<field>[.<field>...]` | a field of the parsed body |
| `principal.<field>[.<field>...]` | a field of the authenticated principal |
| `scope.<scope>` | a resolved tenancy scope |
| `host`, `subdomain` | the request host, or its first label |
| `address`, `address/<bits>` | the client address, or its prefix (`address/64`) |
| `resolver` | an application-implemented resolver (scopes only) |

| Use | Accepted sources |
|---|---|
| requirement `subject` | path, query, header, principal, scope (never body: rights are decided before body validation, FR-5) |
| scope id (`scopes` on a node) | path, query, header, host, subdomain, principal, resolver ([A23](../decisions.md#a23)) |
| `bindings` key / value | path, query, body / principal |
| `concurrency.version` | body, query, header (`header.If-Match` reads a strong entity tag) |
| bucket `key` | address, address prefix, principal, body |
| signature `key` | path, query, header |
| union `discriminator.from` | header (a route's whole input, ADR 0003 section 3) |

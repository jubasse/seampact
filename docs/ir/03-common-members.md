### 3. Common members

Every IR object of the kinds below has the members it needs from this list, with these meanings:

| Member | Meaning |
|---|---|
| `id` | the stable key: the catalogue name as written, or for a derived element the canonical identifier of its name (section 9, ADR 0007) |
| `name` | `{ segments: string[], role: string, status?: number }`, the canonical name (ADR 0007 and its amendment); never a final identifier. `status`, from 200 to 399, is present if and only if `role` is `response` (section 13) |
| `origin` | where it was declared (section 6) |
| `derivedFrom` | present on, and only on, an element the compiler derived (section 6) |
| `docs` | `{ summary?, description? }`, resolved text |
| `extensions` | the extension slot: `{ "<prefix>": { "<key>": value } }`, on every object a consumer may extend (api, operation, schema, property, right, rule, scope) and kept empty elsewhere for later use |

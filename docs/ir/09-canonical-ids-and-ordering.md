### 9. Canonical ids and ordering

- Ids are the catalogue names as written (schemas, enums, rights, codes...). A derived name (an inline schema, a derived operation id) has the id given by ADR 0007's canonical identifier of its segments. A derived id equal to a declared one is a compile error naming both.
- Records (`Record<...>`) are JSON objects; their order is the serialisation order of section 10.
- Arrays keep the written order where order is meaningful, and are sorted otherwise:

| Kept in written or semantic order | Sorted |
|---|---|
| `requires`; `input.proofs` (requirement order); `scopes` (resolution order); `upstream` (owner first); enum `values`; `bucket.key`; `properties` and declared `params` (written order, [A33](../decisions.md#a33); derived params after them); template members; a paging style's `request`; `examples` values of a schema; `packs` (application order) | `operations` (by id); a union's variants (by tag); `errors` (by status, then code); `responses` (by status); `tags`, `vary`, `callerKinds`, `directions`, `kinds`, `features`; `schemes.read`, `schemes.write` and `schemes.optionalRead` of an identity; `fieldRights` (by schema, then pointer, then direction); `sortKeys` (by key); `bindings` (by source) |

Object properties keep the order the author wrote them in (A33), so generated types and Java record constructors list fields as written. ADR 0002 makes that order independent of files: an `$include` merges its keys at its own position, `allOf` members merge in their written order, a `pick` keeps the order of its `fields` and an `omit` the source's order. Properties the compiler adds (a concurrency version field) follow the authored ones. A rule proof read in the body is not a property of the input schema but an element of `input.proofs`, which targets render after the schema's properties (section 13).

---
"@seampact/spec": minor
"@seampact/compiler": patch
---

A sensitive scalar answered as a whole body, an array item, a map key or a response header now keeps its mark and makes the response `no-store`, or is a compile error under the new `conventions.cache.sensitiveElsewhere: refuse`.

## IR change

- irRevision: 5 to 6
- Classification: tightening (ADR 0005 section 4: a reader of the new revision refuses IR an older compiler could write)

| Field or kind | Schema path | Change | Additive, tightening or breaking | Guarded by |
|---|---|---|---|---|
| `ScalarTypeUse.sensitive` | `schemas.schema.json#/$defs/ScalarTypeUse/properties/sensitive` | added | additive | exact `irRevision` match (before 1.0) |
| `Cache.noStore` | `operation.schema.json#/$defs/Cache/properties/noStore` | invariant `ir.cache.sensitive-no-store` also reaches a sensitive scalar use, a map key and a response header's type | tightening | exact `irRevision` match (before 1.0) |

### What a target must do

- Read `ScalarTypeUse.sensitive` where it redacts sensitive values (logs, traces, idempotency storage), as it reads `Property.sensitive`.
- Nothing more for caching: the compiler writes `noStore` on every operation whose response carries a sensitive value, and a target that honours `noStore` sends `Cache-Control: no-store`; a hand-written IR document whose response carries a sensitive scalar use or header without `noStore` is now refused.

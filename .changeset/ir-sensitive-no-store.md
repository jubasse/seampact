---
"@seampact/spec": minor
---

`checkIrInvariants` now refuses an operation whose response carries a sensitive field unless its `cache` sets `noStore` (invariant `ir.cache.sensitive-no-store`).

## IR change

- Classification: tightening (ADR 0005 section 4: a reader of the new revision refuses IR an older compiler could write)

| Field or kind | Schema path | Change | Additive, tightening or breaking | Guarded by |
|---|---|---|---|---|
| `Cache.noStore` | `operation.schema.json#/$defs/Cache/properties/noStore` | new invariant `ir.cache.sensitive-no-store` | tightening | exact `irRevision` match (before 1.0) |

### What a target must do

- Nothing: the compiler already writes `noStore` on such an operation, and a target that honours `noStore` sends `Cache-Control: no-store` for it.

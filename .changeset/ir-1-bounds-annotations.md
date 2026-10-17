---
"@seampact/spec": minor
"@seampact/compiler": patch
---

The IR bounds every integer to the safe range and keeps the written annotations it used to lack: a schema's `deprecated`, a property's `examples`, a union variant's `docs`, a response's `docs`, and the docs and examples of array items, map keys and values and JSON content schemas.

The derivation table credits tree with the `binary` and `redirect` response shapes and a body source's version property, which derive.wire no longer claims.

## IR change

- irRevision: 2 to 3
- Classification: tightening (ADR 0005 section 4). A revision 3 reader refuses an integer outside -(2^53 - 1) to 2^53 - 1, which a revision 2 compiler could write. The new members are optional and additive: a reader that ignores them generates no weaker check.

| Field or kind | Schema path | Change | Additive, tightening or breaking | Guarded by |
|---|---|---|---|---|
| every integer | `*.schema.json`, each `"type": "integer"` | `maximum` 9007199254740991 added where none was tighter (`irVersion`, `irRevision`, `PathApiVersion.number`, sizes, durations, limits, `SourceLocation` positions) | tightening | exact `irRevision` match (before 1.0) |
| `deprecated` | `schemas.schema.json#/$defs/ObjectSchema/properties/deprecated`, same on `MapSchema` and `UnionSchema` | added (optional boolean, absent means false) | additive | none |
| `examples` | `schemas.schema.json#/$defs/Property/properties/examples` | added (optional list of values) | additive | none |
| `docs` | `schemas.schema.json#/$defs/UnionVariant/properties/docs` | added (optional `Docs`) | additive | none |
| `docs`, `examples` | `schemas.schema.json#/$defs/RefTypeUse/properties/docs`, same on `OpaqueTypeUse`, `FileTypeUse`, `EnumTypeUse`, `ScalarTypeUse`, `ArrayTypeUse` | added (optional) on every kind; the compiler writes them on array items, map keys and values and JSON content schemas | additive | none |
| `docs` | `operation.schema.json#/$defs/Response/properties/docs` | added (optional `Docs`) | additive | none |

### What a target must do

- Declare `irRevision: 3`.
- Read IR integers as values from -(2^53 - 1) to 2^53 - 1, each literal as the correctly rounded double; the Kotlin and PHP models refuse any other as a read error, and the Kotlin model no longer caps a number literal at 64 characters.
- Emit a schema's `deprecated`, a property's `examples`, a variant's `docs`, a response's `docs` and a nested use's `docs` and `examples` where the target writes documentation (OpenAPI: natively, ADR 0004 section 12), or ignore them: none changes a check.

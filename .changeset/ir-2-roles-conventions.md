---
"@seampact/spec": minor
"@seampact/compiler": patch
---

The IR now carries what a target renders from typed members alone: error role bindings with their params, the retry header, the api wire conventions, the degraded header, the deprecation date, header semantics and successor rel, a field never sent and sort-key rights, with nine new invariants and a stated order for every array.

The compiler writes the default `api.wire`, the deprecation header semantics, the successor rel and the degraded header, and refuses a non-default `int64`, `outputEnums` or `urls` convention by name until a target acts on it.

## IR change

- irRevision: 3 to 4
- Classification: breaking, guarded by the exact `irRevision` match (ADR 0005 sections 2 and 4). `Api.wire` and `Deprecation.since` are new required members, `ResponseHeader.semantic` changes type from a string to an open enum, and a reader that ignored the other guarded members would generate a weaker or wrong check. The new invariants and `ValueSourceIn` must-act are tightenings; `OperationError.retryHeader` is additive.

| Field or kind | Schema path | Change | Additive, tightening or breaking | Guarded by |
|---|---|---|---|---|
| `always` | `operation.schema.json#/$defs/FieldRight/properties/always` | added (optional must-act open enum `FieldRightAlways`, known `absent`) | breaking | exact `irRevision` match (before 1.0) |
| `params`, `subject` | `operation.schema.json#/$defs/SortKey/properties/params`, `.../subject` | added (optional opaque params, optional `FieldRightSubject`) | breaking | exact `irRevision` match (before 1.0) |
| `ValueSourceIn` | `common.schema.json#/$defs/ValueSourceIn` | must-act added | tightening | exact `irRevision` match (before 1.0) |
| `wire` | `ir.schema.json#/$defs/Api/properties/wire` | added, required (`ApiWire`: `int64` `Int64Wire`, `outputEnums` `OutputEnumForm`, `urls` `UrlForm`, open enums) | breaking | exact `irRevision` match (before 1.0) |
| `header` | `operation.schema.json#/$defs/Degradable/properties/header` | added (optional RFC 9110 token) | tightening | exact `irRevision` match (before 1.0) |
| `successorRel` | `operation.schema.json#/$defs/Deprecation/properties/successorRel` | added (optional registered rel name) | breaking | exact `irRevision` match (before 1.0) |
| `semantic` | `operation.schema.json#/$defs/ResponseHeader/properties/semantic` | type changed (string to open enum `ResponseHeaderSemantic`: the four identity semantics, `deprecation`, `sunset`, `successorLink`) | breaking | exact `irRevision` match (before 1.0) |
| `roles` | `operation.schema.json#/$defs/OperationError/properties/roles` | added (optional non-empty list of `ErrorRoleBinding`: `role`, compiled `Template` `params`) | breaking | exact `irRevision` match (before 1.0) |
| `retryHeader` | `operation.schema.json#/$defs/OperationError/properties/retryHeader` | added (optional `RetryHeader`: `name`, `param`, `unit` `RetryUnit`, `derivedFrom`) | additive | none |
| `since` | `operation.schema.json#/$defs/Deprecation/properties/since` | added, required (calendar date) | breaking | exact `irRevision` match (before 1.0) |
| `ir.field-right.always` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.sort-key.right` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.value.exact-number` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.degradable.header` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.deprecation.headers` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.deprecation.since` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.operation.role-once` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.error.role-params` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |
| `ir.error.retry-header` | `checkIrInvariants` | invariant added | tightening | exact `irRevision` match (before 1.0) |

### What a target must do

- Declare `irRevision: 4` and regenerate from the new Kotlin and PHP models; refuse an unknown `FieldRight.always` or `ValueSource.in` value, as for every must-act definition.
- Act on `api.wire`: the `int64` wire form, open output enums and the URL form; under `urls: absolute`, start every URL with one configured public origin, never the request `Host` or forwarded headers, and refuse to generate or to start without it.
- Render error role params from `roles` with the render rules of ADR 0004 section 7, bounding the issues list it renders, and write the retry header, the degraded header and the deprecation headers with the exact values ADR 0004 section 7 fixes; `vectors/ir/role-params.json` and `vectors/ir/header-values.json` hold the expected renders.
- Skip the decide call for a field right with `always: absent`, and read a sort key's right subject from `subject`.

---
"@seampact/spec": minor
"@seampact/compiler": patch
---

The IR gains the body fields of rule proofs on an operation's input (`OperationInput.proofs`) and the origin layer `core` for the declarations the compiler supplies itself. The compiler keeps `core` out of raw layer ids (`RawLayerId`) and gives `operations[].input.proofs` to access.rights.

## IR change

- irRevision: 1 to 2
- Classification: breaking (ADR 0005 section 4; allowed before 1.0 with this note, A8): a revision 1 reader refuses an IR holding a `core` origin with a schema error, since `Origin.layer` is closed. `checkIrSupport` names the revision mismatch before that.

| Field or kind | Schema path | Change | Additive, tightening or breaking | Guarded by |
|---|---|---|---|---|
| `proofs` | `operation.schema.json#/$defs/OperationInput/properties/proofs` | added (optional) | additive | none |
| `InputProof` | `operation.schema.json#/$defs/InputProof` | added: `{ name, schema: TypeUse, derivedFrom }`, all required | additive | none |
| `layer` | `common.schema.json#/$defs/Origin/properties/layer` | closed value `core` added | breaking | none |
| `ir.origin.core` | `checkIrInvariants` (`README.md`) | invariant added: a core pointer names an entry of `formats`, `errors` or `schemas` (or a position below one), present in the document unless `api` is set | tightening (no revision 1 IR holds a core origin) | none |
| `ir.id.scalar` | `checkIrInvariants` (`README.md`) | extended to `InputProof.schema` (neither `opaque` nor `file`) | tightening (the new member only) | none |

The source map is unchanged: its key pattern already refuses `core#…`, since a core origin has no entry. ADR 0004 section 13 reserves the schema ids of the core declarations (`ApiSchemaInvalidParams`, `ApiForbiddenParams`, `ApiSortKeyForbiddenParams`, `ApiPayloadTooLargeParams`, `ApiRateLimitedParams`, `ApiSchemaInvalidIssue`); the reservation is a compile-time rule, not an IR change.

### What a target must do

- Declare `irRevision: 2`.
- Render a request body as the properties of `input.schema` followed by the fields of `input.proofs`, each required and sensitive; never re-derive a body proof from `rules`. A header proof stays a derived header parameter.
- Accept `core` as an origin layer. A core origin has no source-map entry: never look one up there; a diagnostic about a core element is located at the use that pulled it in.

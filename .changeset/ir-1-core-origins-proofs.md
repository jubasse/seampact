---
"@seampact/spec": minor
"@seampact/compiler": patch
---

The IR gains the body fields of rule proofs on an operation's input (`OperationInput.proofs`, with a wire form in a form or multipart input) and the origin layer `core` for the declarations the compiler supplies itself. The compiler keeps `core` out of api layer ids (`ApiLayerId`, with `FileLayerId` for a layer read from a file) and out of diagnostic origins (`DiagnosticOrigin`), lists the reserved core schema ids (`derivationCoreSchemaIds`), and lets access.rights write `operations[].input.proofs` and the proof-only input of a route without one. The compiler bump stays a patch before 1.0 although its public types narrow: `Diagnostic.origin`, `RelatedLocation.origin`, `RawLayer.layer`, `RawApi.visibility`, `LayerBuild`, `layerKindOf` and `schemaKindOf` no longer accept `core`.

## IR change

- irRevision: 1 to 2
- Classification: breaking (ADR 0005 section 4; allowed before 1.0 with this note, A8). A revision 1 reader refuses an IR holding a `core` origin with a schema error, since `Origin.layer` is closed, and `proofs` changes the meaning of an input: a body proof leaves the input schema, so a reader that ignores `proofs` drops a required check. Before 1.0 both are guarded by the exact `irRevision` match (`checkIrSupport` names the mismatch first); from 1.0 a member like `proofs` needs a feature name.

| Field or kind | Schema path | Change | Additive, tightening or breaking | Guarded by |
|---|---|---|---|---|
| `proofs` | `operation.schema.json#/$defs/OperationInput/properties/proofs` | added (optional); a body proof moves out of the input schema into it | breaking (change of meaning) | exact `irRevision` match (before 1.0) |
| `InputProof` | `operation.schema.json#/$defs/InputProof` | added: `{ name, schema: TypeUse, wire?: FieldWire, derivedFrom }` | breaking (with `proofs`) | exact `irRevision` match (before 1.0) |
| `layer` | `common.schema.json#/$defs/Origin/properties/layer` | closed value `core` added | breaking | none |
| `ir.origin.core` | `checkIrInvariants` (`README.md`) | invariant added: a core pointer starts with an entry of `formats`, `errors` or `schemas`, present in the document unless `api` is set; only that entry is checked | tightening (no revision 1 IR holds a core origin) | none |
| `ir.input-proof.wire` | `checkIrInvariants` (`README.md`) | invariant added: a proof has `wire` exactly when its input is form or multipart (partition `OperationInput.media`) | tightening (the new member only) | none |
| `ir.input-proof.name` | `checkIrInvariants` (`README.md`) | invariant added: proof names are distinct and name no property of a `ref` input schema and no `fields` entry | tightening (the new member only) | none |
| `ir.id.scalar` | `checkIrInvariants` (`README.md`) | extended to `InputProof.schema` (neither `opaque` nor `file`) | tightening (the new member only) | none |

The source map is unchanged: its key pattern already refuses `core#…`, since a core origin has no entry. ADR 0004 section 13 reserves the schema ids of the core declarations (`ApiSchemaInvalidParams`, `ApiForbiddenParams`, `ApiSortKeyForbiddenParams`, `ApiPayloadTooLargeParams`, `ApiRateLimitedParams`, `ApiSchemaInvalidIssue`, `ApiEmptyBody`); a reserved params id yields to a declaration of its default code with `params`, and the format id `bare` to a declared `bare`. The reservation, the proof identity and the pruning of unused core declarations are compile-time rules, not IR changes.

### What a target must do

- Declare `irRevision: 2`.
- Render a request body as the properties of `input.schema` followed by the fields of `input.proofs`, each required and sensitive; never re-derive a body proof from `rules`. A proof-only input has the empty schema `ApiEmptyBody`, so the same rule holds. A header proof stays a derived header parameter.
- In a form or multipart input, send each proof with its `wire`, as an entry of `fields` is sent.
- Treat proof names as known keys of the input use: the unknown-key policy never refuses or ignores them, and `keep` never collects them.
- Accept `core` as an origin layer. A core origin has no source-map entry: never look one up there; a diagnostic about a core element is located at the use that pulled it in.

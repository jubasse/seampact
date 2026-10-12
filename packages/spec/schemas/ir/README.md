# The IR JSON Schema

The seampact IR (ADR 0004) as JSON Schema 2020-12, for target authors and for the generators of the IR models (TypeScript here, Kotlin and PHP in ADR 0010). Validate an IR document against `ir.schema.json`, and a source map against `source-map.schema.json`. The other files hold the definitions they reference.

The schema is written in the subset of ADR 0003, so every definition maps to a type without hand-written parts. This note covers what that subset leaves to the IR: open enums, the union idiom and readers' rules.

## Files and ids

Each file has a stable `$id` under `https://seampact.dev/schemas/ir/` (`https://seampact.dev/schemas/ir/ir.schema.json`), and every `$ref` is relative, to a definition of the same file (`#/$defs/Origin`) or of a sibling (`common.schema.json#/$defs/Origin`). Load every file before validating. `$schema`, `$id` and `$defs` appear only at a file's root; definition names are unique across the files.

The ids carry no revision: the revision a schema describes is `IR_REVISION` in `@seampact/spec/ir`.

## Open enums

Every IR enum is open (ADR 0005 section 3). It is a string with its known values listed in the `x-seampact-known` annotation, never a closed `enum`:

```json
{ "type": "string", "x-seampact-known": ["get", "post", "put", "patch", "delete"] }
```

The annotation never validates: any string is accepted. A reader that acts on the value and meets one it does not know fails with a diagnostic naming the value, the member and the operation; it never guesses and never skips. A reader that does not act on it ignores it. Register the keyword with your validator (Ajv: `addKeyword`, as `IR_KEYWORDS` in `@seampact/spec/ir` does).

`Origin.layer` is the one closed string: a pattern, `api`, `shared`, `base` or `pack:<name>`.

## Tagged unions

A tagged union is a wrapper object with `discriminator` and `oneOf`, whose variants are references to object definitions that each fix their tag with `const`:

```json
"TypeUse": {
  "type": "object",
  "discriminator": { "propertyName": "kind" },
  "oneOf": [{ "$ref": "#/$defs/RefTypeUse" }, { "$ref": "#/$defs/OpaqueTypeUse" }]
},
"RefTypeUse": {
  "type": "object",
  "required": ["kind", "schema"],
  "properties": { "kind": { "type": "string", "const": "ref" }, "schema": { "$ref": "common.schema.json#/$defs/SchemaId" } }
}
```

- The wrapper holds no `properties`; each variant requires its tag. The tag is `kind`, or the member ADR 0004 tags on (`in` for a union tag, `verify` for a signature, `policy` for unknown query keys).
- Known variants validate strictly: the validator picks the variant by its tag (Ajv: `discriminator: true`) and checks it alone.
- An unknown tag is named, not a generic schema error: the validator reports the tag member, its value and the union's pointer (Ajv: keyword `discriminator`, `params.error` `mapping`). The tag stays open: an IR reader accepts the document and treats the object as an unknown variant, which a reader that must act on it refuses by name (`classifyIrErrors` in `@seampact/spec/ir` sorts these into `unknownKinds`).
- A model generator maps the wrapper to a sealed class (Kotlin) or an abstract class (PHP), each variant to a subclass, and adds an `Unknown` variant that keeps the raw value (ADR 0010). TypeScript gets the union of the variants.

A union in ADR 0004 whose variants share no single tag (`{ value } | { from }`, `ValueSource`) is one object with the members of every variant, optional where a variant lacks them; its description says which combinations are valid, and the compiler writes only those.

## Other shapes

- A catalogue is a map keyed by id: `additionalProperties` with the value definition and `propertyNames` with the id. A declaration is referenced by id, never nested.
- A schema with no shape keyword (`{}`, optionally with a description) is an opaque value: any JSON value, kept raw.
- An optional member is one outside `required`.

## Readers

- Ignore unknown members: an additive IR change adds them (ADR 0005 section 4).
- The compiler checks its own output against the strict form, `strictIrSchemas()`: the same files with every object closed, computed from them.

## Changing the IR

From M1, every change is its own PR raising `IR_REVISION`, with a changeset written from `CHANGE-TEMPLATE.md` (ADR 0005 section 1). Regenerate the TypeScript types with `UPDATE_IR_TYPES=1 pnpm vitest run packages/spec/src/ir/types.test.ts`.

# The IR JSON Schema

The seampact IR (ADR 0004) as JSON Schema 2020-12, for target authors and for the generators of the IR models (TypeScript here, Kotlin and PHP in ADR 0010). Validate an IR document against `ir.schema.json`, and a source map against `source-map.schema.json`. The other files hold the definitions they reference. From M1 these files are normative for member shapes; the TypeScript sketches of ADR 0004 are informative (ADR 0004 section 13).

The schema is written in the subset of ADR 0003, so every definition maps to a type without hand-written parts. This note covers what that subset leaves to the IR: open enums, the union idiom and readers' rules.

## Files and ids

Each file has a stable `$id` under `https://seampact.dev/schemas/ir/` (`https://seampact.dev/schemas/ir/ir.schema.json`), and every `$ref` is relative, to a definition of the same file (`#/$defs/Origin`) or of a sibling (`common.schema.json#/$defs/Origin`). Load every file before validating. `$schema`, `$id` and `$defs` appear only at a file's root; definition names are unique across the files.

The ids carry no revision: the revision a schema describes is `IR_REVISION` in `@seampact/spec/ir`.

Every object, tagged union and open enum is a named definition, never an anonymous shape inside a member, so every generated model names its types.

## Open enums

Every IR enum is open (ADR 0005 section 3). It is a string with its known values listed in the `x-seampact-known` annotation, never a closed `enum`:

```json
{ "type": "string", "x-seampact-known": ["get", "post", "put", "patch", "delete"] }
```

The annotation never validates: any string is accepted. A reader that acts on the value and meets one it does not know fails with a diagnostic naming the value, the member and the operation; it never guesses and never skips. A reader that does not act on it ignores it. Register the keyword with your validator (Ajv: `addKeyword`, as `IR_KEYWORDS` in `@seampact/spec/ir` does).

`Origin.layer` is the one closed string: a pattern, `api`, `shared`, `base`, `pack:<name>`, or `workspace` (a diagnostic on `workspace.yaml`; no IR element carries it). It is the exception to open enums recorded in ADR 0004 section 13.

## Must-act unions and enums

A union or an open enum marked `"x-seampact-must-act": true` guards a security boundary: who may call, which right or rule applies, how a credential or a signature is checked, what happens to a restricted field or an unknown key, idempotency and CSRF. An unknown tag or value there makes the whole IR invalid for every reader, even one that does not act on it, because a reader that skipped it would generate a weaker check without saying so (ADR 0005 section 3). `createIrValidator` reports such a document as invalid in the open form too. A new tag or value on a must-act definition always comes with a feature name (`CHANGE-TEMPLATE.md`).

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

- The wrapper holds no `properties`; each variant requires its tag. The tag is `kind`, or the member ADR 0004 tags on (`in` for a union tag, `verify` for a signature, `policy` for unknown query keys and for a signed identity's unknown keys).
- Known variants validate strictly: the validator picks the variant by its tag (Ajv: `discriminator: true`) and checks it alone.
- An unknown tag is named, not a generic schema error: the validator reports the tag member, its value and the union's pointer (Ajv: keyword `discriminator`, `params.error` `mapping`). The tag stays open: an IR reader accepts the document and treats the object as an unknown variant, which a reader that must act on it refuses by name. `listIrUnknowns` in `@seampact/spec/ir` lists every unknown tag and open-enum value with its pointer.
- A model generator maps the wrapper to a sealed class (Kotlin) or an abstract class (PHP), each variant to a subclass, and adds an `Unknown` variant that keeps the raw value (ADR 0010).
- TypeScript gets `Known<Name>`, the union of the variants, and `<Name>`, that union plus the explicit unknown arm `UnknownVariant<tag>` (its tag typed `string & {}`). TypeScript narrows no union holding such an arm, so a reader narrows first with `isKnownVariant("<Name>", value)`, handles the unknown arm by name, then switches on the tag of the known variants.

A shape whose cases share no tag stays one object, with an invariant saying which members go together: `ValueSource` (by `in`), `FieldWire` (by `kind`) and `MetaMember` (by `fill`). Every other choice between shapes is a tagged union.

## Other shapes

- A catalogue is a map keyed by id: `additionalProperties` with the value definition and `propertyNames` with the id, whose pattern is the grammar of ADR 0002 section 4 (an id never reads as `__proto__`). A declaration is referenced by id, never nested.
- A schema with no shape keyword (`{}`, optionally with a description) is an opaque value: any JSON value, kept raw.
- An optional member is one outside `required`.
- A numeric refinement (`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`) is a decimal literal string (`"9223372036854775807"`, `"0.01"`), compared numerically, so no digit is lost in any language. Every other IR number is an integer.
- `nullable` is a member of `Property` and, for every other position (array items, map values, parameters, headers, bodies), an optional member of the type use.

## Readers

- Ignore unknown members: an additive IR change adds them (ADR 0005 section 4).
- Read an IR map with `Object.hasOwn` or through a `Map`, never with a bare `obj[key]`: a key is data, and `constructor` or an enum value such as `__proto__` would otherwise reach the prototype.
- Validate with `createIrValidator(Ajv2020, "open")` (`Ajv2020` from `ajv/dist/2020.js`): it registers the annotation keywords, loads every file, and sorts errors into unknown kinds, unknown values, unknown members and problems. Its options, `IR_AJV_OPTIONS`, are mandatory for the compiler and for any reader wiring its own validator: open tags need a validator that understands `discriminator`, collects every error (`allErrors`: an unknown tag is an expected error and must not hide the real ones after it), and filters the expected mapping errors, as `classifyIrErrors` does.
- A reader of a third-party bundle caps the input size before validating: collecting every error costs time and memory in the size of the input.
- The compiler checks its own output against the strict form, `createIrValidator(Ajv2020, "strict")` over `strictIrSchemas()`: the same files with every object closed, computed from them; the strict form also refuses unknown tags and values.

## Changing the IR

From M1, every change is its own PR raising `IR_REVISION`, with a changeset written from `CHANGE-TEMPLATE.md` (ADR 0005 section 1). Regenerate the TypeScript types with `UPDATE_IR_TYPES=1 pnpm vitest run packages/spec/src/ir/types.test.ts`.

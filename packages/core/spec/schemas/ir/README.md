# The IR JSON Schema

The seampact IR (ADR 0004) as JSON Schema 2020-12, for target authors and for the generators of the IR models (TypeScript here, Kotlin and PHP in ADR 0010). Validate an IR document against `ir.schema.json`, and a source map against `source-map.schema.json`. The other files hold the definitions they reference. From M1 these files are normative for member shapes; the TypeScript sketches of ADR 0004 are informative (ADR 0004 section 13).

The schema is written in the subset of ADR 0003, so every definition maps to a type without hand-written parts. This note covers what that subset leaves to the IR: open enums, the union idiom and readers' rules.

## Files and ids

Each file has a stable `$id` under `https://seampact.dev/schemas/ir/` (`https://seampact.dev/schemas/ir/ir.schema.json`), and every `$ref` is relative, to a definition of the same file (`#/$defs/Origin`) or of a sibling (`common.schema.json#/$defs/Origin`). Load every file before validating. `$schema`, `$id` and `$defs` appear only at a file's root; definition names are unique across the files.

The ids carry no revision: the revision a schema describes is `IR_REVISION` in `@seampact/spec/ir`.

Every object, tagged union and open enum is a named definition, never an anonymous shape inside a member, so every generated model names its types. Definition names are therefore part of the generated-model contract: renaming a definition or a union variant is a breaking IR change (`CHANGE-TEMPLATE.md`).

## Open enums

Every IR enum is open (ADR 0005 section 3). It is a string with its known values listed in the `x-seampact-known` annotation, never a closed `enum`:

```json
{ "type": "string", "x-seampact-known": ["get", "post", "put", "patch", "delete"] }
```

The annotation never validates: any string is accepted. A reader that acts on the value and meets one it does not know fails with a diagnostic naming the value, the member and the operation; it never guesses and never skips. A reader that does not act on it ignores it. Register the keyword with your validator (Ajv: `addKeyword`, as `IR_KEYWORDS` in `@seampact/spec/ir` does).

`Origin.layer` is the one closed string: a pattern, `api`, `shared`, `base`, `pack:<name>`, `core` (a declaration the compiler supplies: its pointer is the one its declaration would have in a layer file, starting with `/formats/<id>`, `/errors/<code>` or `/schemas/<id>`, and it has no source-map entry), or `workspace` (a diagnostic on `workspace.yaml`; no IR element carries it). It is the exception to open enums recorded in ADR 0004 section 13.

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
- `checkIrClosedDeclaration` in `@seampact/spec/ir` is the guard for a compiler pass that copies a declaration it read in the open form: it refuses an unknown tag, open-enum value or member by pointer, so no unread data reaches the strict finalize check.
- A model generator maps the wrapper to a sealed class (Kotlin) or an abstract class (PHP), each variant to a subclass, and adds an `Unknown` variant that keeps the raw value (ADR 0010).
- TypeScript gets `Known<Name>`, the union of the variants, and `<Name>`, that union plus the explicit unknown arm `UnknownVariant<tag>` (its tag typed `string & {}`). TypeScript narrows no union holding such an arm, so a reader narrows first with `isKnownVariant("<Name>", value)`, handles the unknown arm by name, then switches on the tag of the known variants.
- A producer types each union value it writes as `Known<Name>` (`{ kind: "cookie", ... } satisfies KnownScheme`): `<Name>` also accepts the unknown arm, so a mistyped tag or a missing member would compile there. A closed writer view of the whole IR for the compiler passes is recorded for p2-pipeline; it is a package addition, not an IR change.

Every choice between shapes is a tagged union (`Scheme` and `Identity` on `kind`, among others), except where one member decides which optional members are present and several of its values share one shape: a union would repeat that shape once per value. These stay structs, each with a stable-id invariant that applies to its known values only:

- `ValueSource`, by `in`: `name` for the named sources, none for the bare ones, `prefixBits` for `address` only, and `resolver` and `holderField` in one place each.
- `FieldWire`, by `kind`: the five query wire kinds carry `style`, `explode` and `brackets`; `file` and `json` carry none.
- `MetaMember`, by `fill`: `source` only for `fill: source`.
- `HeaderDecl`, by `semantic`: `name` and `in` for every semantic but `versionToken`, which carries `response` and `request`.
- `Cache`, by `family`: `directives` for every family but `never`, which sets `noStore`. `family` is an open string, not an enum: the invariant reads the one reserved name `never`, and any other family is a plain one.

A hand-written partition of a deciding member's values (`ValueSource.in`, `FieldWire.kind`) must stay a disjoint union of the schema's known list: `invariants.test.ts` asserts it, so a new known value fails there until its invariant decides it.

## Other shapes

- A catalogue is a map keyed by id: `additionalProperties` with the value definition and `propertyNames` with the id, whose pattern is the grammar of ADR 0002 section 4 (such an id never reads as `__proto__`). A right (`RightId`) and a principal variant (`VariantId`) take any name, `__proto__` included. A declaration is referenced by id, never nested.
- A schema with no shape keyword (`{}`, optionally with a description) is an opaque value: any JSON value, kept raw.
- An optional member is one outside `required`.
- A numeric refinement (`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`) is a decimal literal string (`"9223372036854775807"`, `"0.01"`), compared numerically, so no digit is lost in any language. Every other IR number member is an integer from -(2^53 - 1) to 2^53 - 1, the safe range of I-JSON (RFC 7493): each integer definition states a `minimum` and a `maximum` within that range, and every reader, a JavaScript one included, holds it exactly. Values held as opaque JSON (`examples`, `default`, extension values) are not IR integer members and are not bounded.
- `nullable` is a member of `Property` and, for every other position (array items, map values, parameters, headers, bodies), an optional member of every type use but the opaque one (an opaque value already admits `null`).

## Invariants the schema cannot state

The ADR 0003 subset has no conditional keyword, so these cross-member rules live beside the schema, each with a stable id. `checkIrInvariants(ir)` in `@seampact/spec/ir` checks them: pure, without Ajv, run by the compiler's finalize pass (p2-finalize, the owner) after the strict form. The native readers do not run them: they share the reader-check corpus `packages/core/spec/vectors/ir/` (ADR 0010). A rule decided by an open-enum value (`semantic`, `role`, `fill`, `in`, `kind`) applies to the values the schema lists in `x-seampact-known` only; an unknown value is the reader's to name. A new invariant is a tightening IR change and relaxing or removing one is breaking (`CHANGE-TEMPLATE.md`).

| Id | Rule |
|---|---|
| `ir.name.status` | `Name.status` is present if and only if `role` is `response` (200 to 399, ADR 0007 amendment). |
| `ir.meta.source` | `MetaMember.source` is present if and only if `fill` is `source`. |
| `ir.value-source.members` | `ValueSource.name` with `path`, `query`, `header`, `body`, `principal`, `scope` and `holderField`; no `name` with `host`, `subdomain`, `resolver` and `address`; `prefixBits` only with `address`. |
| `ir.value-source.place` | `in: resolver` only as an operation scope's source; `in: holderField` only as a field right subject's source. |
| `ir.header.members` | `HeaderDecl.name` and `in` for every semantic but `versionToken`; `response` and `request` for `versionToken` only. |
| `ir.cache.directives` | `Cache.directives` is absent if and only if the family is `never`, and a `never` family sets `noStore`. |
| `ir.csrf.cookie` | An unsafe operation whose access accepts a cookie scheme has `csrf` (derived or exempt). |
| `ir.field-wire.members` | `FieldWire` of kind `file` or `json` has no `style`, `explode` or `brackets`; a query wire kind has all three. |
| `ir.property.nullable` | A property's type use has no `nullable`: `Property.nullable` holds it. |
| `ir.scalar.type` | A named format's own type names no `scalar`. |
| `ir.id.scalar` | `Scope.idSchema` and `ResourceSubject.idSchema` are a `scalar` or `enum` type use without `nullable`; `RuleProof.schema` and `InputProof.schema` are anything but `opaque` and `file`. |
| `ir.ref.resolves` | Every member whose schema is a `$ref` to a catalogue id definition (the key of a top-level or api map, such as `SchemeId` or `SurfaceId`) names an existing key, read with `Object.hasOwn`. |
| `ir.input-proof.wire` | An `InputProof` has `wire` if and only if its input's `media` is `application/x-www-form-urlencoded` or `multipart/form-data` (known media only), and its `wire.kind` is never `file`. |
| `ir.input-proof.name` | The names of an input's `proofs` are distinct, and none is the name of a property of the input's object schema (a `ref` use) or of an entry of its `fields`. |
| `ir.input-proof.input` | An `OperationInput` with `proofs` has a `ref` use as its `schema` (never a `scalar`, `enum`, `opaque`, `file` or `array` use), naming an `object` schema (never a `map` or `union` schema). Unknown use and schema kinds are left to the reader; a missing schema is `ir.ref.resolves`'. |
| `ir.origin.core` | An `Origin` of layer `core` has a pointer that starts with `/formats/<id>`, `/errors/<code>` or `/schemas/<id>`; without `api`, that entry exists in the document. Only the entry is checked, not the rest of the pointer. |
| `ir.cache.sensitive-no-store` | Planned (p2-finalize): a response that carries a sensitive field sets `Cache.noStore`. Not checked yet: it needs a walk of the response schemas. |

## Readers

- Ignore unknown members: an additive IR change adds them (ADR 0005 section 4).
- Check `irVersion`, `irRevision`, `kinds` and `features` first: `checkIrSupport` in `@seampact/spec/ir` names every mismatch, with the operation id for a per-operation kind or feature.
- Always read an IR map with `Object.hasOwn` or through a `Map`, never with a bare `obj[key]`: a key is data, rights and principal variants take any name, and a key such as `__proto__` or `constructor` would otherwise reach the prototype.
- Validate with `createIrValidator(Ajv2020, "open")` (`Ajv2020` from `ajv/dist/2020.js`): it registers the annotation keywords, loads every file, and sorts errors into unknown kinds, unknown values, unknown members and problems. Its options, `IR_AJV_OPTIONS`, are mandatory for the compiler and for any reader wiring its own validator: open tags need a validator that understands `discriminator`, collects every error (`allErrors`: an unknown tag is an expected error and must not hide the real ones after it), and filters the expected mapping errors, as `classifyIrErrors` does. A mapping error that names no union `listIrUnknowns` found fails closed: `classifyIrErrors` counts it as a must-act unknown.
- A reader of a third-party bundle caps the input size before validating: collecting every error costs time and memory in the size of the input.
- The compiler checks its own output against the strict form, `createIrValidator(Ajv2020, "strict")` over `strictIrSchemas()`: the same files with every object closed, computed from them; the strict form also refuses unknown tags and values.

## Changing the IR

From M1, every change is its own PR raising `IR_REVISION`, with a changeset written from `CHANGE-TEMPLATE.md` (ADR 0005 section 1). Regenerate the TypeScript types with `UPDATE_IR_TYPES=1 pnpm vitest run packages/core/spec/src/ir/types.test.ts` and the Kotlin and PHP models with `node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write`.

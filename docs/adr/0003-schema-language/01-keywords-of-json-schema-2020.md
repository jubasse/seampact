### 1. Keywords of JSON Schema 2020-12

Every keyword of the 2020-12 vocabularies, kept or refused. A refused keyword is a compile error citing this table's reason (SCN-006).

#### Core vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `$schema` | refused | the dialect is fixed by seampact and the authoring schema |
| `$id` | refused | a schema's identity is its catalogue name; a second identifier would be a second fact |
| `$ref` | kept, with ADR 0002's meaning | identity-preserving references by name or file; siblings allowed only from the annotation and mark list of section 6 |
| `$anchor` | refused | names live in the catalogue |
| `$dynamicRef`, `$dynamicAnchor` | refused | generic, late-bound schemas have no counterpart in any target's type system |
| `$vocabulary` | refused | the vocabulary is fixed |
| `$comment` | refused | YAML comments serve; a `$comment` would reach no output |
| `$defs` | refused | named schemas live in the `schemas` catalogue, one place |

#### Applicator vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `allOf` | kept, restricted | every member is an object schema; the compiler merges them into one object in the IR (a property declared twice with different schemas is an error), so targets never see composition and Java or PHP need no intersection types |
| `anyOf` | refused | an untagged union cannot be decoded by a client without trying each branch, and validators disagree on overlaps; use `oneOf` with a discriminator, `nullable`, or an opaque value (section 2) for a third party's untagged shape |
| `oneOf` | kept, tagged only | section 3; always with a discriminator and a mapping |
| `not` | refused | negative constraints have no native form in Bean Validation, Laravel or Symfony constraints |
| `if`, `then`, `else` | refused | conditional validation is not portable and hides two types in one; use a tagged union |
| `dependentSchemas` | refused | conditional, same reason |
| `prefixItems` | refused | tuples map to no record or class type; a third party's tuple is an opaque value (section 2) |
| `items` | kept | an array has exactly one item schema |
| `contains` | refused | no native counterpart in most targets; no consumer |
| `properties` | kept | |
| `patternProperties` | refused | key-dependent schemas map to no type; use a map (section 2) |
| `additionalProperties` | kept, map form only | `additionalProperties: <schema>` on an object without `properties` declares a map with string keys; `true` and `false` are refused because direction decides strictness (section 4) |
| `propertyNames` | kept, map form only | the key schema of a map: a string schema with `format`, `pattern`, length or an enum, for tables keyed by id |

#### Unevaluated vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `unevaluatedItems`, `unevaluatedProperties` | refused | direction decides how unknown fields are treated |

#### Validation vocabulary

| Keyword | Decision | Reason |
|---|---|---|
| `type` | kept, one value | `string`, `integer`, `number`, `boolean`, `object` or `array`; `null` and type arrays are refused, nullability is `nullable` (section 5) |
| `const` | refused | a one-value field is an enum or a union tag; keeping both would give two ways to state it |
| `enum` | kept, by reference | `enum: <EnumName>` or a narrowing (section 7); inline value lists are refused because enums live in one catalogue, where each is declared once with its values, source and fallback (FR-29) |
| `multipleOf` | kept on `integer` and decimal | refused on `number`, where binary floating point makes the check differ between targets |
| `maximum`, `exclusiveMaximum`, `minimum`, `exclusiveMinimum` | kept | portable range checks (number values only, as in 2020-12) |
| `maxLength`, `minLength` | kept | counted in Unicode code points, as JSON Schema says. A validator target counts them so under `rules: seampact-consistent`; its default, `rules: native`, uses the library's own rule and count (yup counts UTF-16 units), and each validator page lists these differences |
| `pattern` | kept, portable subset | section 9 |
| `maxItems`, `minItems` | kept | |
| `uniqueItems` | refused | no native, exact check in Bean Validation or class-validator, and "equal" differs for objects; no consumer |
| `maxContains`, `minContains` | refused | `contains` is refused |
| `maxProperties`, `minProperties` | refused | no consumer; map size limits wait for one |
| `required` | kept | the only way to make a property required (section 5) |
| `dependentRequired` | refused | conditional presence; use a tagged union |

#### Format annotation, content and meta-data vocabularies

| Keyword | Decision | Reason |
|---|---|---|
| `format` | kept, closed set | section 8: the portable formats plus named formats declared by packs; any other value is refused, so every target validates the same strings |
| `contentMediaType`, `contentSchema` | kept, restricted | on a `string` field of a form or multipart input only, with `contentMediaType: application/json`: the text is parsed and validated against `contentSchema` (ADR 0002 section 7, [A39](../../decisions.md#a39)). Files are the `file` shape (section 2), not a string with a media type, because a file has a size limit and several accepted types |
| `contentEncoding` | refused | base64 inside JSON has no consumer; files travel as multipart parts or downloads |
| `title`, `description` | kept | docs; `description` may be a `$file` |
| `default` | kept, with a semantics | section 10 |
| `deprecated` | kept | emitted to OpenAPI and read by the diff |
| `readOnly`, `writeOnly` | refused | they make one schema stand for two types; a payload that differs between input and output is two schemas (`CreateTask`, `Task`), the input one usually derived from the other with `pick` or `omit` (section 2) |
| `examples` | kept | each value is parsed against the schema at compile time (section 11) |

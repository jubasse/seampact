### 5. Optional and nullable

The IR keeps both, as two fields of a property (FR-3, SCN-005):

- optional: the property is not listed in the object's `required`. An absent optional property is absent in every target (`undefined` in TypeScript, an absent key on emit), never turned into null.
- nullable: `nullable: true` on the property's schema. The value may be JSON `null`.

A property may be both. `nullable` replaces JSON Schema's `type: [T, 'null']` and `anyOf` with `null`, because those two spellings would let one fact take two forms; the emitter writes OpenAPI 3.1's type array (or `oneOf` with `null` around a reference).

Both states reach the handler apart, in every language. `UpdateArticle` in section 2 shows why: an absent `publishOn` means "leave it", `null` means "clear it", so `{}` and `{ "publishOn": null }` are two requests. TypeScript has `undefined`; a Java record component or a PHP promoted property does not, so targets of those languages use, for a property that is both optional and nullable and only for it, a three-state type (absent, null, value) from the hooks package (`io.github.jubasse.seampact.hooks.Field<T>`, `Seampact\Hooks\Field`, or its vendored copy, ADR 0009). A required nullable property is a plain nullable type; an optional non-nullable one is `Optional<T>` in Java and a nullable type in PHP that the boundary never fills with `null` from the wire. Stripping a restricted input field ([A21](../../decisions.md#a21) `strip`) sets it absent. The shared payload table holds the two requests above.

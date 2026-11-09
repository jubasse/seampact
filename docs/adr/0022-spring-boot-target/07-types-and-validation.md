### Types and validation

Generated value types:

- final records for objects;
- sealed interfaces for unions, with an `Unknown` arm only on input readers;
- enums;
- `Optional<T>` for an optional member, a plain reference for a required nullable one, and `seampact-hooks`'s `Field<T>` for three-state members, so `{}` and an explicit `null` stay apart (CHK-158).
- `OffsetDateTime` for a `date-time`, kept with the offset it was sent with: the boundary's own mapper does not adjust it to the context time zone, which Jackson 3 does by default.

Wire names that differ from the Java member name are carried by `@JsonProperty`, which Jackson 3 keeps in `com.fasterxml.jackson.annotation`.

Step 6 decodes path, query, headers and the held body to a Jackson 3 `JsonNode` with the boundary's own `JsonMapper`, never the app's bean (ADR 0012 "Each target places the steps"). It then runs two passes:

1. **A generated structural validator** walks the tree and carries every rule of the contract, so a request gets every issue at once: `required`, `type` (no coercion), `unknownKeys`, `enum`, `oneOf`, the discriminator and every value rule. The value rules whose Jakarta meaning differs from the contract's keep the contract's meaning:
   - string lengths in code points, where `@Size` counts UTF-16 units;
   - `pattern` as an ECMA-262 search, where `@Pattern` matches the whole string;
   - `format`;
   - `multipleOf`.
   An opaque value takes any JSON, `null` only when nullable (ADR 0003 section 2), but a number past the range of a double anywhere inside it is a `type` issue, as on the PHP targets.
   Each issue carries its `{ in, pointer, rule }` from the tree, and the issues are bounded by `MAX_RENDERED_ISSUES = 100`.
2. **The boundary's own `JsonMapper` binds** the tree to the input record. After the structural pass the binding cannot fail; a failure is a 500.

Pass 1 runs the normalised pattern of ADR 0003 section 9 on `java.util.regex` with `find()`, `^` and `$` written `\A` and `\z` and astral escapes in Java's `\x{...}` form, so it searches as ECMA-262 does.

The boundary runs no Bean Validation pass: a second pass would only repeat pass 1's rules. The records keep the standard constraints whose meaning is the contract's (`@Min`, `@Max`, `@DecimalMin` and `@DecimalMax` with `inclusive`, `@Size` on arrays and maps, `@NotNull`, `@Valid`), for the app's own `@Valid`; the app adds a Jakarta Validation provider only for that use.

# ADR 0003: Schema language

Status: accepted

## Context

Every body, parameter, header, principal, error param and rule param of a contract is described by a schema. The schema language belongs to seampact, not to a validator ([lesson 6](../decisions.md#lesson-6)): no zod, class-validator, Bean Validation, Laravel or Symfony idiom may reach the contract or the IR, and every target maps the IR's schemas onto its own validator and type system (FR-3). The base is a stated subset of JSON Schema 2020-12, with these additions: direction, tagged unions, optional versus nullable, portable formats, marks, portable refinements, deterministic names and parsed examples.

The subset has one test: every server target (TypeScript with zod, yup or class-validator, Java with Bean Validation, PHP with Laravel and Symfony validation) and every client target must accept and reject exactly the same payloads for a schema (SCN-028, SM-9). A keyword that one of them cannot check natively and exactly is either refused or given a precise, portable meaning here. A JavaScript validator target guarantees this verdict under `rules: seampact-consistent`; by default (`rules: native`) it renders the library's own rule wherever the library has one, so the library behaves as its users know it, and its documentation lists where that differs from the meaning here.

[A30](../decisions.md#a30) applies: a schema describes the payload only. Envelopes, page shapes and error bodies are wire formats chosen by the contract's conventions (ADR 0002 section 13), never fields of a contract schema.

Schemas are written where ADR 0002 allows one: the `schemas` catalogue, `item`, `input`, `output`, `responses.*.body`, fields maps (`id`, `pathParams`, `query`, `headers`, `params`), `principal`, and the `schema` of an identity header or rule proof. A plain string in those positions names a schema (ADR 0002 section 2).

## Options

1. Full JSON Schema 2020-12, each target doing its best.
2. A new type language (TypeSpec-like or a home-grown IDL in YAML).
3. A written subset of JSON Schema 2020-12, each kept keyword given one portable meaning, plus a few explicit additions that compile to IR fields.

Option 1 is what experience with validator-shaped contracts warns against: validator quirks leak into the document, and conditional or dynamic keywords have no counterpart in Bean Validation or Laravel rules, so targets would silently check less (FR-14 forbids a weaker check). Option 2 throws away editor support, OpenAPI familiarity and the existing JSON Schema validators the compiler uses. Option 3 is chosen.

## Decision

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File | Contains |
|---|---|---|
| 1. Keywords of JSON Schema 2020-12 | [0003-schema-language/01-keywords-of-json-schema-2020.md](0003-schema-language/01-keywords-of-json-schema-2020.md) | Core vocabulary; Applicator vocabulary; Unevaluated vocabulary; Validation vocabulary; Format annotation, content and meta-data vocabularies |
| 2. Shapes | [0003-schema-language/02-shapes.md](0003-schema-language/02-shapes.md) | Opaque values; Derived objects: `pick` and `omit` |
| 3. Tagged unions | [0003-schema-language/03-tagged-unions.md](0003-schema-language/03-tagged-unions.md) |  |
| 4. Direction | [0003-schema-language/04-direction.md](0003-schema-language/04-direction.md) |  |
| 5. Optional and nullable | [0003-schema-language/05-optional-and-nullable.md](0003-schema-language/05-optional-and-nullable.md) |  |
| 6. Marks and other additions | [0003-schema-language/06-marks-and-other-additions.md](0003-schema-language/06-marks-and-other-additions.md) |  |
| 7. Enums at a use | [0003-schema-language/07-enums-at-a-use.md](0003-schema-language/07-enums-at-a-use.md) |  |
| 8. Formats | [0003-schema-language/08-formats.md](0003-schema-language/08-formats.md) |  |
| 9. Portable regular expressions | [0003-schema-language/09-portable-regular-expressions.md](0003-schema-language/09-portable-regular-expressions.md) |  |
| 10. Defaults | [0003-schema-language/10-defaults.md](0003-schema-language/10-defaults.md) |  |
| 11. Examples | [0003-schema-language/11-examples.md](0003-schema-language/11-examples.md) |  |
| 12. Names | [0003-schema-language/12-names.md](0003-schema-language/12-names.md) |  |
| 13. What a schema never holds | [0003-schema-language/13-what-a-schema-never-holds.md](0003-schema-language/13-what-a-schema-never-holds.md) |  |

## Consequences

- Phase 1's authoring JSON Schema refuses every keyword marked refused here, with this ADR's reason in the diagnostic.
- PHP targets decode with objects preserved (`json_decode($s, false)`) for the type pass, because `json_decode($s, true)`, which Laravel's request input uses, gives `{}` and `[]` the same empty array: they refuse `{}` where a list is declared and `[]` where an object is, emit an empty object as `{}`, and check integers as whole numbers in the safe range. The generated routes are excluded from Laravel's `TrimStrings` and `ConvertEmptyStringsToNull`, which rewrite input before validation, and a required string maps to `present` plus `string`, since `required` fails on `""`. The payload table holds the `{}` versus `[]` and `1.0` cases.
- class-validator needs generated code for three cases its decorators do not cover: a union at the root of an input (class-transformer's discriminator works on nested `@Type` properties only), a per-subtree `unknownKeys` (`forbidNonWhitelisted` applies to a whole `validate` call), and an optional property that is not nullable (`@IsOptional()` treats `null` as absent). Its `@Length` discounts some code points (variation selectors), so string lengths are checked by generated code. The validator agreement table (ADR 0015) holds each case.
- The validator targets (zod, yup, class-validator, VineJS, Bean Validation, Laravel, Symfony) each need code for: code-point string lengths, int64 and decimal strings, the regex anchoring rules, unknown-key refusal on input (dropping under `unknownKeys: ignore`, passing on under `keep`), opaque values, header-tagged unions, and stripping on emit. The shared payload table tests each case in CI (SCN-028).
- Contracts lose some expressiveness: conditional schemas, `anyOf`, tuples and inline enums must be rewritten as tagged unions, separate schemas or catalogue enums, or, for a shape a third party fixes, declared opaque with a reason. A refused keyword comes back only with a consumer and an ADR.
- A create or update input derived with `pick` or `omit` holds each constraint once, in the item schema; the price is that a reader follows `from` to see a field's refinements.
- `int64` on the wire is a string by default even for targets that could hold a 64-bit number, which costs one conversion in Java and PHP and buys one wire form for every client; an api that sends numbers says so in its conventions.
- A30 keeps schemas free of wire-format fields, so the same contract can switch formats through its conventions without touching a schema.

## Traceability

- FRs: FR-3 (subset, direction, unions, optional and nullable, formats, marks, refinements, names, examples), FR-12 (credential lint, allow-list), FR-15 (one payload behaviour for zod, yup and class-validator), FR-23 (`restrictedTo`, input policy), FR-29 (enum uses and emission), FR-30 (defaults), FR-42 and A30 (no envelope in schemas); A36 and A40 (opaque values, unknown-key policies), A39 (files, JSON text fields).
- CHK items enabled: CHK-002, CHK-024, CHK-025, CHK-026, CHK-033, CHK-047, CHK-048, CHK-049, CHK-053, CHK-080, CHK-092, CHK-134, CHK-139, CHK-146, CHK-151, CHK-158, CHK-159, CHK-135 (`additionalMember`).

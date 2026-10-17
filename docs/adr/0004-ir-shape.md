# ADR 0004: IR shape

Status: accepted

## Context

The IR is the seam of the whole project. Every generator, the OpenAPI emitter, lint and diff read it and nothing else; generators written outside the repository, in Kotlin and PHP, read it through models generated from its JSON Schema (FR-40). It must be canonical and fully resolved, deterministic to the byte, versioned, and carry source locations without letting them break byte stability (FR-9).

Inputs this ADR must honour:

- ADR 0002 (grammar) and ADR 0003 (schema language): what the IR resolves.
- FR-9 (fully resolved, deterministic, side table), FR-37 (irVersion and irRevision, additive by design, extension slots, open enums), FR-38 (names as word segments plus a role), FR-40 (generated Kotlin and PHP models), FR-23 (field rights per operation), FR-6 (`derivedFrom` on every derived element).
- ADR 0008 (packs): the IR lists the packs applied; wire formats must express both wrapping and merging envelopes; media types are recorded.
- ADR 0014 (room for real-time and RPC): a top-level list of declaration kinds, declarations at the api level, HTTP operations in their own collection, explicit media types, errors identified by code with the HTTP status as an attribute, kind-tagged operation references, an extension slot on properties.

A first sketch of the IR, written during framing, is the starting point. This ADR fixes the top-level layout, the operation, the requirement union, origins and `derivedFrom`, the side table, canonical ordering and ids, and the byte-stable serialisation. How the IR evolves is ADR 0005; which pass writes which field is ADR 0006; how names become identifiers is ADR 0007.

## Options

1. The first sketch as is: a flat record per api with `Record`s of declarations and a sorted operation list.
2. A normalised graph (every node an entity with an id, edges in separate tables).
3. The sketch, extended to the inputs above, with three structural rules: declarations live at the api level and are referenced by id; operations hold everything a target needs without walking schemas; every derived element names where it came from.

Option 2 is harder to read and to generate models from, and pushes joins onto every target. Option 1 misses rights, scopes, formats, field rights, media types and kinds. Option 3 is chosen.

## Decision

One IR document per api, fully resolved and deterministic: the only input of every generator, the OpenAPI emitter, lint and diff. Declarations live at the api level and are referenced by id; operations hold everything a target needs without walking schemas; origins are logical pointers, with locations in a side table; serialisation is byte-stable.

The sections are cited as "ADR 0004 section N" and live one per file under `docs/ir/`.

| Section | File |
|---|---|
| 1. One IR document per api | [ir/01-one-document-per-api.md](../ir/01-one-document-per-api.md) |
| 2. Top-level layout | [ir/02-top-level-layout.md](../ir/02-top-level-layout.md) |
| 3. Common members | [ir/03-common-members.md](../ir/03-common-members.md) |
| 4. Declarations | [ir/04-declarations.md](../ir/04-declarations.md) |
| 5. Schemas | [ir/05-schemas.md](../ir/05-schemas.md) |
| 6. Origins and `derivedFrom` | [ir/06-origins-and-derivedfrom.md](../ir/06-origins-and-derivedfrom.md) |
| 7. The operation | [ir/07-the-operation.md](../ir/07-the-operation.md) |
| 8. Wire formats and paging styles | [ir/08-wire-formats-and-paging.md](../ir/08-wire-formats-and-paging.md) |
| 9. Canonical ids and ordering | [ir/09-canonical-ids-and-ordering.md](../ir/09-canonical-ids-and-ordering.md) |
| 10. Byte-stable serialisation | [ir/10-byte-stable-serialisation.md](../ir/10-byte-stable-serialisation.md) |
| 11. The source-location side table | [ir/11-source-location-side-table.md](../ir/11-source-location-side-table.md) |
| 12. The OpenAPI mapping | [ir/12-the-openapi-mapping.md](../ir/12-the-openapi-mapping.md) |
| 13. Schema forms (amendment 2026-10-12, M1) | [ir/13-schema-forms.md](../ir/13-schema-forms.md) |

## Consequences

- Phase 1 writes this shape as the IR JSON Schema and its TypeScript types, then generates the Kotlin and PHP models from the schema (FR-40). Field names here are the ones phase 1 uses; additions follow ADR 0005.
- Targets never walk schemas for rights, never re-derive errors or headers, and find every wire-format detail in `formats`: the IR is larger, target code is smaller and the same in every language.
- Origins as logical pointers keep the IR byte-stable when files move; the cost is one extra lookup through the side table to print a location.
- The OpenAPI mapping is fixed per IR member (section 12), so the docs app, the drift check and every tool reading the document see the same `x-seampact-*` extensions; a construct that OpenAPI lacks costs an extension and its published schema, not an emitter's choice. An app may emit a cleaner document (fewer extensions, no reasons, strict input schemas); each document's options are part of its app config, so its drift check stays exact.
- The `kinds` list, code-identified errors with `http.status`, explicit media types and kind-tagged references are paid now so a later transport is additive (ADR 0014).
- Authored property order makes reordering the properties of a schema an IR change, visible in the diff and in generated constructors; the diff classifies it as non-breaking on the wire.

## Traceability

- FRs: FR-9, FR-11 (the OpenAPI mapping and its `x-seampact-*` extensions), FR-37 (extension slots, open `kind` members), FR-38 (names as segments and role), FR-40 (subset-shaped JSON Schema for model generation), FR-2 (origins of inherited settings), FR-5 (requirements union and order), FR-6 (`derivedFrom`, errors by code), FR-8 (`relays`, documents), FR-23 (field rights), FR-30 (query wire form), FR-31 and A31 (paging styles), FR-33, FR-42 and A30 (formats), FR-27, FR-28; amendment A43 (which documents exist, merged documents).
- CHK items enabled: CHK-024, CHK-025, CHK-033, CHK-045, CHK-052, CHK-059, CHK-077, CHK-078, CHK-092, and the IR side of every server item (CHK-011 to CHK-043), CHK-124 to CHK-136, CHK-138, CHK-149 to CHK-153, CHK-160, CHK-171 (merged documents), CHK-172 (distinct component keys).

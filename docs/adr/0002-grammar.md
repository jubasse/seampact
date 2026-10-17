# ADR 0002: Authoring grammar

Status: accepted

## Context

A contract is written in YAML only ([A38](../decisions.md#a38)). The grammar is the decision hardest to change later: every contract, the authoring JSON Schema, the loader, the compiler passes and the editor experience depend on it. Framing started from a first sketch of the grammar; this ADR fixes the final grammar and gives a reason for each departure from that sketch.

This ADR fixes every keyword a contract file may contain, outside the inside of a schema. The schema language itself (JSON Schema keywords kept and refused, direction, unions, marks such as `sensitive` and `restrictedTo`) is ADR 0003; this ADR only says where a schema may appear. What the compiler makes of the tree is the IR (ADR 0004) and the pass pipeline (ADR 0006). What a convention pack may set, and how packs and packages are resolved, is ADR 0008; this ADR defines the keywords they use.

Forces:

- One fact, one place ([lesson 1](../decisions.md#lesson-1)). A grammar that lets the same fact be written twice needs a gate to hold the copies together.
- Deny by default, and a reason on every safety exception (FR-4, [A40](../decisions.md#a40)).
- Nothing ahead of use ([lesson 5](../decisions.md#lesson-5)): a keyword exists only if a checklist item or an amendment needs it.
- The core imposes nothing ([A36](../decisions.md#a36), after [A20](../decisions.md#a20), [A25](../decisions.md#a25), [A30](../decisions.md#a30)): no header name, error code, right name, envelope, page shape, wire format, versioning scheme, query encoding or implementation. Where the compiler needs a value to work, it has a default the contract can rename or replace, and everything else comes from the contract's base file or from opt-in convention packs. What the grammar does demand is explicitness: every route states its access, every exception its reason.
- Inline and included content must compile to the same bytes (FR-1, FR-9).
- The YAML must mean the same thing to every parser, in every language (FR-1).

## Options

1. Keep the first sketch as written.
2. Replace it with an OpenAPI-like flat list of paths and operations.
3. Keep the sketch's model (a tree mirroring the URL, catalogues of named declarations, `ops` shorthand, `requires`) and change what does not hold up once rights, scopes, signed webhooks, several apis and A30 are added.

Option 1 does not cover [A18](../decisions.md#a18) to A25 (rights, scopes, neutral hooks) or [A5](../decisions.md#a5) (signed webhooks), and some of its forms are ambiguous (children of a `single` mixed with settings keywords; `requires` items that cannot tell a right from a rule). Option 2 loses inheritance, which is what lets a contract state an identity, a scope or an error once for a whole subtree. Option 3 is chosen. Each departure from the sketch is listed with its reason in "Departures from the first sketch".

## Decision

The grammar fixes every keyword a contract file may contain, outside the inside of a schema. Composition (`extends`, `packs`, `$include`, `$ref`, `$file`) resolves first, and inline and included content compile to the same bytes. A contract is a workspace file, shared files and one api file per api; the api file holds surfaces whose routes mirror the URL, and catalogues of named declarations (schemas, enums, errors, rights, rules, identities, conventions). The core imposes no house convention: those come from the base or from packs.

The sections are cited as "ADR 0002 section N" and live one per file under `docs/grammar/`; the worked example and the scenario self-check are in `docs/grammar/example.md`.

| Section | File |
|---|---|
| 1. Files and the workspace | [grammar/01-files-and-the-workspace.md](../grammar/01-files-and-the-workspace.md) |
| 2. Composition: `extends`, `packs`, `$include`, `$ref`, `$file` | [grammar/02-composition-extends-packs-include.md](../grammar/02-composition-extends-packs-include.md) |
| 3. YAML subset and refused pitfalls | [grammar/03-yaml-subset-and-refused.md](../grammar/03-yaml-subset-and-refused.md) |
| 4. Scalars, names and value sources | [grammar/04-scalars-names-and-value.md](../grammar/04-scalars-names-and-value.md) |
| 5. The api file | [grammar/05-the-api-file.md](../grammar/05-the-api-file.md) |
| 6. Surfaces and the tree | [grammar/06-surfaces-and-the-tree.md](../grammar/06-surfaces-and-the-tree.md) |
| 7. Routes | [grammar/07-routes.md](../grammar/07-routes.md) |
| 8. Inherited settings | [grammar/08-inherited-settings.md](../grammar/08-inherited-settings.md) |
| 9. Access, identities, rights, rules, scopes | [grammar/09-access-identities-rights-rules.md](../grammar/09-access-identities-rights-rules.md) |
| 10. Lists, cache and lifecycle settings | [grammar/10-lists-cache-and-lifecycle.md](../grammar/10-lists-cache-and-lifecycle.md) |
| 11. Errors and natures | [grammar/11-errors-and-natures.md](../grammar/11-errors-and-natures.md) |
| 12. Enums, examples, docs, extensions, lint | [grammar/12-enums-examples-docs-extensions.md](../grammar/12-enums-examples-docs-extensions.md) |
| 13. Conventions and wire formats | [grammar/13-conventions-and-wire-formats.md](../grammar/13-conventions-and-wire-formats.md) |
| 14. Paging styles | [grammar/14-paging-styles.md](../grammar/14-paging-styles.md) |
| 15. The presets of the first-party packs | [grammar/15-first-party-pack-presets.md](../grammar/15-first-party-pack-presets.md) |
| 16. Seeing an operation whole: `seampact explain` | [grammar/16-seampact-explain.md](../grammar/16-seampact-explain.md) |
| Worked example, scenario self-check | [grammar/example.md](../grammar/example.md) |

## Departures from the first sketch

| Sketch | Final | Reason |
|---|---|---|
| `api: { name, version, maturity }` only | adds `kind`, `role`, `caller`, `compat`, `documents` | FR-8, FR-13, FR-34 need them, and they are api facts |
| resources and routes in two maps at the top | one `routes` map per node; the node says its kind (`kind` or `method`) | two maps allowed the same name twice; the kind is already stated |
| top-level `resources` under an implicit surface | each surface holds its tree | several surfaces per api, each with its prefix, identity and documents |
| `prefix: /v1` | `prefix: /v{version}`, literal version refused, `conventions.pathVersion: none` or a surface's `pathVersion: none` to opt out | the version is one fact, held on the api (FR-2); the path version is a default (A33) |
| `kind` absent | `kind: product` or `service` | "surface" already names a tree root |
| version in the input schema | added by the compiler from `concurrency`; query or header on a DELETE | one fact, and no DELETE body (A33) |
| `path: /health` | relative `path`, no leading slash, default from the node name | paths mirror the tree; a leading slash suggested an absolute path that the prefix then changed |
| children of a `single` mixed with its settings | children under `routes` | a child named like a setting (`cache`) was ambiguous |
| `collection:` and `member:` holding children | they are nodes: settings plus `routes` | settings per scope (a scope id read from the member path) |
| `ops` plus `overrides` | `ops` as a list or a mapping of op settings | one place per op; no override for an op that is not listed |
| `create` input defaults | `create` and `update` require `input` | the item schema holds fields a client never sends |
| `requires: [{ roles: {...} }]` | `{ right: roles, params: {...} }` or `{ rule: ... }` | rights and rules are two catalogues (A18); a subject must not mix with params |
| `on: pathParam` in rule params | `subject` with a value-source grammar | one grammar for every value read from the request |
| the same requirement written in full on every route | a `requirements` catalogue of named items, used by name | YAML anchors are refused (P5), and a role-gated api repeats the same right and params on many routes |
| `throttles:` | `buckets:` plus a rule with `bucket: true` | the bucket is what is counted; throttling is the rule (FR-41) |
| `identities.*.schemes.write: [session+csrf]` | `csrf` on the cookie scheme | CSRF is derived from the scheme, stated once (FR-27) |
| identity scheme names as strings | typed `schemes` catalogue | schemes are checked and emitted (FR-27) |
| no rights, scopes, signed identities | `rights`, `scopes`, `kind: signed` | A5, A18 to A25 |
| `access: { public }`, implicit optional auth | `public` and `optionalAuth`, each with a reason; a refused credential on `optionalAuth` is anonymous, or 401 with `onRefused: reject` | A33, A40 |
| `csrfExempt` | `csrf: { exempt }` on a node; CSRF only for a cookie scheme that declares `csrf` | one exemption shape (`idempotency: { exempt }`); CSRF is opt-in (A34) |
| `idempotent: true` on a GET, `idempotent: { exempt }` | `idempotency: { exempt }` only | a GET is safe by its method; one name for the convention and the exemption |
| `errors` with fixed derived codes (`api.schema_invalid`) | derivation roles with default codes, renamed by the conventions, by `errorRoles` on any node or by a pack | a contract with no pack compiles (A34), and every code stays renamable (A20, A30, A35) |
| `errors` on routes only | codes declared or attached on any node, inherited below | A35: a resource, scope or single states its codes once |
| `nature` open | three base natures; a `natures` catalogue names others, each mapped onto a base | clients keep one retry rule (FR-6) while a contract keeps its own vocabulary (A40) |
| `conventions` on any node (5.2) | `conventions` on the api, its base and packs only | a convention is one fact for the whole api; per-node values are ordinary inherited settings (section 8) |
| identity headers written inside the identity | a `headers` catalogue, used by identities | a pack supplies header names without the identity (SCN-079) |
| no pack manifest | `pack: { name, version, extends }` and `derive` | a pack is versioned, extends packs and derives rights (ADR 0008, SCN-073) |
| `enums: { Role: [owner, editor] }` | `{ values, source, reason (optional), fallback }` | FR-29: source, docs, fallback; inline value lists are refused because enums live in one catalogue |
| `examples: { 200: ... }` | named examples with `status` or `request` | examples are named (checklist volume) and may target the request |
| implicit envelopes | `conventions.format`, default bare plus problem+json | A30 |
| `$ref: ./schemas/task.yaml` only | also names (`Task`) and plain strings in schema positions; no `#/schemas/...` pointer | readability and one way to name an element; the IR is the same |
| `include` | `$include`, with an optional fragment | every loader directive is `$`-prefixed, so `include` stays usable as a field, parameter or property name (JSON:API's `include` query parameter) |
| `cache: { freshness, etag }` | adds `anonymous` and `vary` | FR-33 caller kinds |
| no workspace | `workspace.yaml` | several apis compile together for `relays` (FR-8) |
| a base per api | an api's base plus the workspace's `shared` file, each layer resolving names only in itself and the layers it builds on | a file several apis use compiles the same for each of them |
| a relaying route restating the public path, body, success and codes | a relay route (`relays`) whose shape is copied from the public operation | one fact, one place: the superset check keeps only what can still differ, the role bindings |

## Consequences

- Phase 1 writes the authoring JSON Schemas, one per file and fragment kind (section 3), from sections 1 to 15 of this ADR; a keyword not listed here is refused by it, and the grammar snapshot test (SM-6) fails when a core keyword is added without an ADR reference.
- The loader implements sections 1 to 4 (composition, the byte-identity rule, pitfalls); the compiler passes implement sections 5 to 14 as ADR 0006 assigns them.
- Contracts carry no house convention: header names, right names, page shapes and wire formats all come from the base or from packs. Derived errors have default codes in the core (A34), each renamable, so a contract with no pack compiles; a paged list still needs a paging style (A31).
- The grammar has four shorthands only: a string for a schema reference, `ops` as a list, `paging` as a style name, and a string in `requires` for a `requirements` entry. Each yields the same IR as its long form, the last one with the entry's name.
- An inherited requirement cannot be removed below; a contract that needs it must restructure its tree. Revisit only with a consumer that cannot.
- Bodies are JSON, forms, multipart uploads and file downloads, and responses include redirects (A39). Not modelled until a consumer needs it: a raw-bytes request body (beyond a signed identity's raw body), range requests, a base extending a base, shorthands beyond `ops`.
- YAML stays the only authoring medium (A38). A one-shot importer from an OpenAPI document into this grammar is planned for v3.

## Traceability

- FRs: FR-1, FR-2, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9 (byte identity, modeline), FR-10 (extension keys, pack keywords), FR-13, FR-20 (keywords), FR-22, FR-23 (sort keys, filteredBy), FR-24, FR-27, FR-28, FR-29 (catalogue), FR-30, FR-31, FR-32, FR-33, FR-34, FR-41, FR-42. Amendments A20, A21, A23, A25, A30 to A36; amendments A39 (bodies beyond JSON, redirects) and A40 (onRefused, reasons on safety exceptions only, verify application, natures); amendment A43 (which documents exist).
- CHK items enabled: CHK-004 to CHK-020, CHK-021 to CHK-023, CHK-027 to CHK-046, CHK-048, CHK-050 to CHK-058, CHK-073, CHK-086, CHK-087, CHK-089, CHK-090, CHK-092 to CHK-095, CHK-100, CHK-124 to CHK-139, CHK-142, CHK-143, CHK-145, CHK-146, CHK-149 to CHK-153, CHK-160, CHK-121 (unknownQuery, allow on its own node), CHK-170 and CHK-171 (which documents exist, A43), CHK-173 (a right's `codeName`).

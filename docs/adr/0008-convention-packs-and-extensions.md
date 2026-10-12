# ADR 0008: Convention packs and user extensions

Status: accepted

## Context

seampact is a contract system, not a framework (amendment [A30](../decisions.md#a30)). The core must not impose a house style: header names, envelope fields, money rules, right names and wire formats differ from one organisation to the next, and experience shows that such conventions leak into the core when there is no other place for them. At the same time every derivation needs concrete values: the idempotency header name, the body-limit default, the code of the error a stale write answers, the shape of a page.

Consumers also need their own domain keys (a tax basis on a money field, the cache keys a write invalidates) without these keys becoming core keywords (the conformance checklist's "14 Extensions" items).

This ADR decides what a convention pack is, what it may set, what stays in the core, how consumer extension keys work, and which packs seampact ships itself. The authoring keywords that reference packs and declare extensions belong to the grammar (ADR 0002); the IR fields that record them belong to the IR shape (ADR 0004). YAML below is illustration only, syntax per ADR 0002.

## Decisions

### A pack is data only

Options: packs as code (a plugin that mutates the IR), packs as data (YAML validated by a published JSON Schema), a mix.

Choice: data only. A pack is a set of YAML files with the same structure as the convention and declaration sections an api may write itself, plus the `pack` manifest (`name`, `version`, `extends`) and its `derive` entries, all with the syntax of ADR 0002 section 2. The version is written once, in the manifest; the compiler refuses a `package.json` whose version differs. A pack contains no code.

Reasons:
- The standalone compiler binary (ADR 0010) applies packs without Node.js, so a Java or PHP consumer compiling a local source gets the same IR as a Node consumer.
- A data pack cannot do what the core forbids. It can only fill the slots this ADR lists, and the compiler validates every value with located diagnostics.
- Code-level house rules still exist, as lint plugins (FR-12). A house kit is a pack plus, when needed, a lint plugin package. The pack never depends on the plugin. Rules written as data in a pack (a closed catalogue of selectors, reusing those of `derive`, and assertions such as "every route of the `hooks` surface uses a signed identity") would let a native consumer apply house rules without Node.js; they wait for a consumer that asks (lesson 5).

A pack is distributed as an npm package whose `package.json` names its YAML entry file, so the Node CLI resolves it like any dependency, from the nearest `package.json` at or above the contract's workspace root (ADR 0002 section 2). A contract's own pack lives beside it and is referenced by path (`packs: [./packs/house.yaml]`): that is where a contract writes its own `derive` entries, such as attaching a plan-limit code to every `create` route, since a base holds none. The same files are vendored into every contract bundle that uses them (ADR 0011), and the first-party packs are embedded in the standalone binary, so a native consumer never needs npm to resolve one.

### What a pack may set

A pack holds the keys of a base (ADR 0002 section 1: every catalogue, `conventions`, `formats`, `extensions`, `lint`) plus its manifest and `derive`, each validated against the pack schema published in `@seampact/spec`. The table names the values the derivations read:

| Slot | Examples | Served FR |
|---|---|---|
| Declarations | `schemas`, `enums`, `schemes`, `identities`, `rights`, `rules`, `scopes`, `buckets`, `services`, beside the catalogues below | FR-1, FR-10 |
| Header names | the idempotency key and replay headers (`conventions.idempotency`), identity headers in the `headers` catalogue (deadline, trace context, actor surface, rights version), the rate-limit and deprecation header names | FR-7, FR-28 |
| Wire formats | `formats`: item, table, list and page shapes with body and header templates, meta fields and who fills each, the error body; media types; the api's format, `conventions.format` | FR-42, A30 |
| Paging styles | `pagings`: request roles mapped to parameter names, response roles mapped to members added to the format's page or to a whole page body, headers and `Link` relations (ADR 0002 section 14); the default style, `conventions.paging.default` | FR-31, [A31](../decisions.md#a31) |
| Named formats | `scalars`: `money` or `iri-reference`, a base JSON type, portable refinements, a description; never the name of a portable format (ADR 0003 section 8) | FR-3 |
| Cache families | a name mapped to a max-age or to `Cache-Control` directives; `never` (no-store) is reserved | FR-33 |
| Error families | error codes with status, nature, family, typed params and an example, added to the registry; an extra code pattern (`conventions.errors.pattern`) | FR-6 |
| Natures | the `natures` catalogue, each mapped onto a base nature ([A40](../decisions.md#a40)) | FR-6 |
| Error role bindings | the code each derivation role answers, renaming the core default ([A34](../decisions.md#a34)), with an optional params template; how far a code attached on a node reaches (`conventions.errors.reach`) | FR-6 |
| Request defaults | idempotency lifetime, methods, whether the key is required and who enforces it, body-limit default, batch `maxIds` and body limit, query encoding and unknown-key policy, body unknown-key policy, int64 wire form, the paging over-limit policy, a restricted field sent without its right (`conventions.restrictedInput`), how output enums are written (`conventions.outputEnums`) | FR-7, FR-29, FR-30, FR-32, FR-41 |
| Route defaults | `conventions.pathVersion`, `conventions.pathCase`, `conventions.ops`, `conventions.operationIds`, `conventions.urls` | FR-2 |
| Lint severities | `lint.rules` (ADR 0002 section 12) | FR-12 |
| Named requirements | `requirements`: requirement items a route uses by name in `requires` (ADR 0002 section 9) | FR-5 |
| Right naming | `conventions.rights.pattern`, a pattern every right name must also match, enforced as an error | FR-22 |
| Derivation entries | `derive`: a selector and effects from closed sets (below) | FR-26 |
| Extension declarations | consumer extension keys with their JSON Schemas (below) | FR-10 |

Derivation entries are the only way a pack adds to what a route ends up with. A selector (`select`) picks routes by closed criteria: `op` (the `ops` name a route came from), `access` (read or write), `apiKind`, `identity`, `tag`. The effects are `declareRight` (a right from a name template, with its subject), `require` (a requirement attached to the route) and `attachErrors`. Templates may use `{resource}` and `{op}` only. Pack-derived requirements come first in a route's `requires`, in pack order, then the ancestors' and the route's own (ADR 0002 section 8). Every element a derivation entry produces is ordinary IR carrying `derivedFrom` with the derivation `pack.<pack>.<entry>` (ADR 0006 section 5); the pack's version is recorded once, in the IR's `packs` list (ADR 0004 section 2) (FR-6).

### What stays core

A pack never:
- adds a keyword to the grammar, or a field to the IR outside the extension slots;
- removes or weakens a derivation of the derivation table, the deny-by-default rule (FR-4), the fixed check order (ADR 0012), the no-store rule on sensitive fields, the reason a safety exception requires, or the three base natures (a pack may name natures, each mapped onto a base);
- redefines a declaration made elsewhere: two layers declaring the same error code, format, paging style, family or right is a compile error naming both locations, as with `extends` (FR-1); a `declareRight` whose name the catalogue already declares reuses that right;
- contains code, or references anything outside its own files and the packs it extends.

The core owns the semantics: which declaration derives which element, the paging roles and what each means, identity kinds, caller kinds, the schema subset (ADR 0003), the IR (ADR 0004) and the hook model (ADR 0012). A pack only supplies values the semantics read.

### The core default wire format

Options: no default (every api must apply a pack), a seampact house envelope, a standard default.

Choice: a standard default, per A30. Without a format pack, a success response is the bare payload: the item, the id-keyed table, or the array of an unpaged list. The core sets no page shape (A31): a paged list names a paging style that the contract declares or a pack provides, and a paged list with neither fails to compile with a diagnostic naming both fixes. An error is an RFC 9457 `application/problem+json` body: `type`, `title` and `status`, with the error code and its typed params carried as extension members, so every target can still discriminate the error union on the code (FR-6). The exact members are fixed once in ADR 0006 section 7, and ADR 0002 section 15 writes the default as format data.

Every derived error answers a role. The roles and their default codes are in ADR 0006 section 6, so a contract with no pack compiles (A34). A pack, the api or its base renames a role for the whole api, and any node of the tree renames it for its subtree ([A35](../decisions.md#a35)). A role bound to an unregistered code, or to a code whose params cannot receive the role's required data, is a compile error naming the role and the fix.

Every other format, including JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring `Page`, and a house envelope such as one with a `servedAt` meta field, is a pack the contract opts into. A target maps the declared format onto its framework's own mechanism (A30): `ProblemDetail` in Spring, an exception filter in NestJS, API Resources in Laravel, normalizers in Symfony. A target that cannot render a declared format fails `generate` with a diagnostic naming the format and the operation (FR-14).

### Applying packs: order and overrides

The layering rule is ADR 0002 section 2, cited here so the two never differ: the packs of the workspace's shared file, of the base and of the api, each in their order, then the shared file, the base and the api. A pack's `extends` are applied just before it, a pack reached twice is applied once at its first position, and the graph must be acyclic. A layer resolves names only in itself and the layers it builds on: a pack sees itself and the packs it extends, so it declares every code, schema or right its entries use.

- Settings (a header name, a default, a family's max-age) are overridden by a later layer, leaf path by leaf path: maps of named entries merge per entry, `errors.every` is a union. The IR records the winning layer of each leaf as its origin.
- Declarations (error codes, named formats, formats, paging styles, rights) are never overridden; a later layer may only override an attached error's example (FR-6).
- The IR lists the packs applied, with their versions, so the compatibility diff (FR-13) shows a pack upgrade as the IR changes it causes.

### User extension keys

Options: free `x-` keys copied through, keys declared with a JSON Schema, a fixed set of extension slots with typed keys.

Choice: declared keys. A consumer declares a prefix (for example `acme`) and its keys, each with a JSON Schema and the places it may appear on (`at`): `api`, `operation`, `schema`, `property`, `right`, `rule` and `scope` (FR-10). Key names follow ADR 0002 section 4 (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`). The declaration lives in any layer: a pack, the shared file, the base or the api.

- The compiler validates every value against its schema and reports file, line, column, key and the schema violation.
- Extension schemas use the schema subset of ADR 0003, so every target can emit a named type for each key.
- The IR keeps the values in the extension slot of the object (ADR 0004); the OpenAPI emitter writes them as `x-<prefix>-<key>`.
- Server targets pass extension values on rights, rules, scopes and operations to the generated boundary: the hook requests of ADR 0012 and the route metadata (amendment [A20](../decisions.md#a20)).
- The prefix `seampact` is reserved. Two declarations of the same prefixed key are a compile error.

An undeclared key is an error, never copied through: a typo must not reach a published document.

```yaml
# packs/acme.yaml (excerpt), the example of ADR 0002 section 12 moved into a pack
enums:
  TaxBasis: { values: [inclusive, exclusive], reason: "Acme's tax rules." }
extensions:
  acme:
    tax-basis: { at: [operation, property], schema: { enum: TaxBasis } }
    invalidates: { at: [operation], schema: { type: array, items: { type: string } } }
```

### First-party packs in 1.0

seampact ships six opt-in packs, all data only, each with its own conformance fixtures ([A24](../decisions.md#a24), [A28](../decisions.md#a28), [A32](../decisions.md#a32)). ADR 0002 section 15 writes the presets of the format packs. Each format pack sets `conventions.format` and `conventions.paging.default` to its own presets when applied, named in its entry below; a later layer may choose others.

- `@seampact/pack-crud-rights` (A24, FR-26). For every route of the `list`, `get`, `create`, `update`, `delete` and `batch` ops, it declares a right `{resource}.{op}` and attaches it as a requirement, first in the route's `requires` (ADR 0002 section 8). On a member route (get, update, delete) the right's subject is the resource, taken from the member id. On a collection route (list, create, batch) the subject is the route's innermost scope when it has one, and none otherwise. A batch route gets its own right (`tasks.batch`) rather than `tasks.get`, because a right has one subject and `tasks.get`'s is the member, which a batch of ids has no single value for. A route that already lists the same right does not get it twice. Without the pack nothing is derived and the core imposes no right name (A20).
- `@seampact/pack-api-platform` (A28, FR-21). JSON-LD items (`jsonld`, the format it sets), Hydra collections and paging (`hydra`, the default style it sets: `page`, `itemsPerPage`, `order[{key}]`), Hydra or problem+json errors, their media types, and the `iri-reference` named format. The api-platform target renders them through API Platform's own serializer, and serves the JSON-LD contexts the format points at (`/contexts/{resource}`, `/contexts/Error`) and Hydra's API documentation link as API Platform's own routes, allow-listed for the boot check. Since the pack is ordinary data, another target may render it too, provided it serves those contexts; the compatibility matrix refuses a target that claims the pack without them (ADR 0009). Whether API Platform also serves its own OpenAPI document is the app's choice, not the pack's ([A43](../decisions.md#a43), ADR 0011).
- `@seampact/pack-laravel`. API Resources (`data` wrapping, the `laravel` format it sets, whose page shape is `{ data, meta }`) and the length-aware and cursor paginators (`laravelPages`, the default style it sets, and `laravelCursor`), rendered by the laravel target through Laravel's own resource collections. It covers success bodies and paginators only: errors stay the bare problem+json, because Laravel's validation error body groups issues by field, which the template language does not express (ADR 0002 section 15).
- `@seampact/pack-spring`. Spring Data's `Page` (`springPage`, the default style it sets: zero-based `page`, `size`, `sort=key,desc`); it sets no format, so errors stay problem+json, which the spring-boot target writes with `ProblemDetail`.
- `@seampact/pack-jsonapi`. JSON:API resource objects (`jsonapi`, the format it sets), `page[number]` and `page[size]` paging (`jsonapiPages`, the default style it sets), `sort`, and the `errors` array, over `application/vnd.api+json`.
- `@seampact/pack-hal`. HAL items and pages (`hal`, the format it sets; `halPages`, the default style it sets, with `_links`, `_embedded` and Spring HATEOAS's `page` object) over `application/hal+json`.

Anyone can write other packs, house envelopes included, without a core change.

## Consequences

- The core grammar has no house keyword. A grammar snapshot test fails when a core keyword is added without an ADR reference (SM-6).
- A contract with no pack compiles and serves bare payloads with problem+json errors and the default error codes, which most frameworks render natively; a paged list still needs a paging style, from the contract or a pack (A31).
- The template model of the IR (ADR 0004 section 8) expresses wrapping formats (data under a key), merged formats (members beside the data's own fields, as in JSON-LD) and per-element templates (Hydra members, JSON:API resource objects, HAL's `_embedded`), and records each response's media type, so every first-party pack and the default format are plain data.
- Packs are versioned packages. A pack upgrade changes the IR and is classified by the diff like any contract change.
- Native consumers compiling with the standalone binary can use first-party packs and packs referenced by path; they cannot resolve a third-party pack from npm without a bundle.

## Traceability

- FRs: FR-10, FR-26 (pack part), FR-42, FR-6 (families and role bindings), FR-22 (naming), FR-21 (api-platform pack), FR-3 (named formats), FR-7, FR-28, FR-31, FR-32, FR-33, FR-41 (values the derivations read); amendments A20, A24, A28, A30, A31, A32, A34, A35, [A36](../decisions.md#a36), A40, A43.
- Checklist items enabled: CHK-125 (natures), CHK-137 (lint severities from packs), CHK-167 (JSON-LD contexts), CHK-003 (error families), CHK-028 (envelopes from a pack), CHK-029 (framework refusals in the declared error format), CHK-036 (cache families), CHK-039 (body-limit defaults), CHK-050 and CHK-051 (consumer extensions), CHK-085 (api-platform formats), CHK-089 (no imposed right naming), CHK-090 (right metadata reaches the boundary), CHK-095 (derived CRUD rights), CHK-106 (no default page shape), CHK-107 (first-party format packs), CHK-110 (default error codes).
- Success metric: SM-6.

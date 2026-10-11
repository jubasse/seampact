# ADR 0008: Convention packs and user extensions

Status: accepted

## Context

seampact is a contract system, not a framework (amendment A30). The core must not impose a house style: header names, envelope fields, money rules, right names and wire formats differ from one organisation to the next, and Arthome's history shows that such conventions leak into the core when there is no other place for them (brief section 3). At the same time every derivation needs concrete values: the idempotency header name, the body-limit default, the code of the error a stale write answers, the shape of a page.

Consumers also need their own domain keys (a tax basis on a money field, the cache keys a write invalidates) without these keys becoming core keywords (brief section 11, checklist section 14 "Extensions").

This ADR decides what a convention pack is, what it may set, what stays in the core, how consumer extension keys work, and which packs seampact ships itself. The authoring keywords that reference packs and declare extensions belong to the grammar (ADR 0002); the IR fields that record them belong to the IR shape (ADR 0004). YAML below is illustration only, syntax per ADR 0002.

## Decisions

### A pack is data only

Options: packs as code (a plugin that mutates the IR), packs as data (YAML validated by a published JSON Schema), a mix.

Choice: data only. A pack is a set of YAML files with the same structure as the convention and declaration sections an api may write itself (syntax per ADR 0002), plus a small manifest naming the pack and its version. It contains no code.

Reasons:
- The standalone compiler binary (ADR 0010) applies packs without Node.js, so a Java or PHP consumer compiling a local source gets the same IR as a Node consumer.
- A data pack cannot do what the core forbids. It can only fill the slots this ADR lists, and the compiler validates every value with located diagnostics.
- Code-level house rules still exist, as lint plugins (FR-12). A house kit is a pack plus, when needed, a lint plugin package. The pack never depends on the plugin.

A pack is distributed as an npm package whose `package.json` names its YAML entry file, so the Node CLI resolves it like any dependency. The same files are vendored into every contract bundle that uses them (ADR 0011), and the first-party packs are embedded in the standalone binary, so a native consumer never needs npm to resolve one.

### What a pack may set

A pack may set exactly these, each validated against the pack schema published in `@seampact/spec`:

| Slot | Examples | Served FR |
|---|---|---|
| Header names | idempotency key and replay headers, deadline, trace context, actor surface, rights version | FR-7, FR-28 |
| Wire formats | success envelope per response kind (item, page, table) with meta fields and who fills each (framework, identity, handler); error body shape; media types | FR-42, A30 |
| Named formats | `money` or `iri-reference`: a name, its base JSON type, portable refinements, a description | FR-3 |
| Cache families | a name mapped to a max-age, or `never` for no-store | FR-33 |
| Error families | error codes with status, nature, typed params and an example, added to the registry | FR-6 |
| Error role bindings | which registered code each derivation role answers (the schema-invalid role, the stale-write role, and so on) | FR-6 |
| Paging page shapes | the body and header layout of a cursor, pages or changes-since page | FR-31 |
| Request defaults | idempotency lifetime, body-limit default, batch `maxIds` and body limit, rate-limit reply headers | FR-7, FR-32, FR-41 |
| Right naming | an identifier pattern stricter than the core's, enforced by the compiler as an error | FR-22 |
| Derivation entries | a selector and an effect from closed sets (below) | FR-26 |
| Extension declarations | consumer extension keys with their JSON Schemas (below) | FR-10 |

Derivation entries are the only way a pack adds to what a route ends up with. A selector picks routes by closed criteria (the `ops` name a route came from, read or write, the api kind, the identity, a tag). An effect is one of: declare a right from a name template, attach a requirement, attach error codes. Templates may use `{resource}` and `{op}` only. Every element a derivation entry produces is ordinary IR carrying `derivedFrom`, naming the pack, its version and the entry (FR-6).

### What stays core

A pack never:
- adds a keyword to the grammar, or a field to the IR outside the extension slots;
- removes or weakens a derivation of the derivation table, the deny-by-default rule (FR-4), the fixed check order (ADR 0012), the no-store rule on sensitive fields or the closed set of error natures;
- redefines a declaration made elsewhere: two layers declaring the same error code, format, family or right is a compile error naming both locations, as with `extends` (FR-1);
- contains code, or references anything outside its own files and the packs it extends.

The core owns the semantics: which declaration derives which element, the paging kinds, identity kinds, caller kinds, the schema subset (ADR 0003), the IR (ADR 0004) and the hook model (ADR 0012). A pack only supplies values the semantics read.

### The core default wire format

Options: no default (every api must apply a pack), a seampact house envelope, a standard default.

Choice: a standard default, per A30. Without a format pack, a success response is the bare payload: the item, the table, or for a list the page object that the paging kind defines (its items and its paging fields, nothing else). An error is an RFC 9457 `application/problem+json` body: `type`, `title` and `status`, with the error code and its typed params carried as extension members, so every target can still discriminate the error union on the code (FR-6). The exact member names are fixed once in the derivation table and published with the IR schema.

The derivation table needs a code for each derived error. The roles and their default codes belong to the derivation table (core lane); a pack or the api itself may rebind any role to a code of its own registry. A role bound to an unregistered code is a compile error naming the role and the fix.

Every other format, including JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring `Page`, and a house envelope such as one with a `servedAt` meta field, is a pack the contract opts into. A target maps the declared format onto its framework's own mechanism (A30): `ProblemDetail` in Spring, an exception filter in NestJS, API Resources in Laravel, normalizers in Symfony. A target that cannot render a declared format fails `generate` with a diagnostic naming the format and the operation (FR-14).

### Applying packs: order and overrides

An api applies packs in the order it lists them, then its base, then its own conventions (syntax per ADR 0002). A pack may extend other packs; the graph must be acyclic.

- Settings (a header name, a default, a family's max-age) may be overridden by a later layer. The IR records the winning layer as the origin.
- Declarations (error codes, named formats, rights) are never overridden; a later layer may only override an attached error's example (FR-6).
- The IR lists the packs applied, with their versions, so the compatibility diff (FR-13) shows a pack upgrade as the IR changes it causes.

### User extension keys

Options: free `x-` keys copied through, keys declared with a JSON Schema, a fixed set of extension slots with typed keys.

Choice: declared keys. A consumer declares a prefix (for example `acme`) and its keys, each with a JSON Schema and the objects it may appear on: apis, operations, schemas, properties, rights, rules and scopes (FR-10). The declaration lives in a pack or in the api's base.

- The compiler validates every value against its schema and reports file, line, column, key and the schema violation.
- Extension schemas use the schema subset of ADR 0003, so every target can emit a named type for each key.
- The IR keeps the values in the extension slot of the object (ADR 0004); the OpenAPI emitter writes them as `x-<prefix>-<key>`.
- Server targets pass extension values on rights, rules, scopes and operations to the generated boundary: the hook requests of ADR 0012 and the route metadata (amendment A20).
- The prefix `seampact` is reserved. Two declarations of the same prefixed key are a compile error.

An undeclared key is an error, never copied through: a typo must not reach a published document.

```yaml
# illustration only, syntax per ADR 0002
extensions:
  prefix: acme
  keys:
    tax-basis:
      on: [properties]
      schema: { enum: [gross, net] }
    invalidates:
      on: [operations]
      schema: { type: array, items: { type: string } }
```

### First-party packs in 1.0

seampact ships two opt-in packs, both data only, each with its own conformance fixtures:

- `@seampact/pack-crud-rights` (A24, FR-26). For every route produced by the `ops` shorthand, it declares a right `{resource}.{op}` and attaches it as the first requirement of the route. On a member route (get, update, delete) the right's subject is the resource, taken from the member id. On a collection route (list, create) the subject is the route's innermost scope when it has one, and none otherwise. A route that already lists the same right does not get it twice. Without the pack nothing is derived and the core imposes no right name (A20).
- `@seampact/pack-api-platform` (A28, FR-21). Declares API Platform's native formats as wire formats: JSON-LD items, Hydra collection pages, and Hydra or problem+json errors, their media types, and the `iri-reference` named format. The api-platform target renders them through API Platform's own serializer; since the pack is ordinary format data, any target able to render it may do so.

Whether seampact ships further first-party format packs (JSON:API, HAL, Laravel paginators, Spring `Page`) is a release decision taken when a consumer needs one (lesson 5). Anyone can write them as third-party packs without a core change.

## Consequences

- The core grammar has no house keyword. A grammar snapshot test fails when a core keyword is added without an ADR reference (SM-6).
- A contract with no pack compiles and serves bare payloads with problem+json errors, which most frameworks render natively.
- The envelope model of the IR (ADR 0004) must express both wrapping formats (data under a key) and merged formats (meta members beside the data's own fields, as in JSON-LD), and must record each response's media type, so that the api-platform pack and the default format are both plain data.
- Packs are versioned packages. A pack upgrade changes the IR and is classified by the diff like any contract change.
- Native consumers compiling with the standalone binary can use first-party packs and packs referenced by path; they cannot resolve a third-party pack from npm without a bundle.

## Traceability

- FRs: FR-10, FR-26 (pack part), FR-42, FR-6 (families and role bindings), FR-22 (naming), FR-21 (api-platform pack), FR-3 (named formats), FR-7, FR-28, FR-31, FR-32, FR-33, FR-41 (values the derivations read); amendments A20, A24, A28, A30.
- Checklist items enabled: CHK-003 (error families), CHK-028 (envelopes from a pack), CHK-029 (framework refusals in the declared error format), CHK-036 (cache families), CHK-039 (body-limit defaults), CHK-050 and CHK-051 (consumer extensions), CHK-085 (api-platform formats), CHK-089 (no imposed right naming), CHK-090 (right metadata reaches the boundary), CHK-095 (derived CRUD rights).
- Success metric: SM-6.

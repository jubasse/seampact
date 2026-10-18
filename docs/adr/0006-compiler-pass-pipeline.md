# ADR 0006: Compiler pass pipeline and derivation table

Status: accepted

## Context

Phase 2 builds the semantic compiler as three passes developed in parallel: tree, access and derivation. Passes developed in parallel on one compiler need a seam that is merged first: a pass interface, a fixed order, and a rule for what each pass may read and write, so that two passes never edit the same field. Derivation is data, not code scattered in targets: the table that says which declaration derives which element must be written down once. And diagnostics are a feature: every one names the file, the line, the column, the rule and the fix (FR-1).

ADR 0008 leaves two values to this ADR: the default code of each derivation role, and the member names of the RFC 9457 error body of the default `bare` format ([A30](../decisions.md#a30)). The core sets no page shape ([A31](../decisions.md#a31)): paging styles are contract or pack data (ADR 0002 section 14).

## Options

1. One monolithic compiler function, split later.
2. A plugin pipeline where each pass may read and write the whole draft IR.
3. A fixed sequence of passes, each declaring the draft-IR fields it reads and writes, with the declaration enforced in tests, plus a derivation table held as data.

Option 1 cannot be built as three passes at once. Option 2 lets passes overwrite each other's fields, so a pass's tests pass alone and fail once merged. Option 3 is chosen.

## Decision

### 1. Stages and passes

```text
load -> validate -> tree -> access -> derive -> link -> finalize
```

| Step | Kind | Input | Output |
|---|---|---|---|
| load | stage | the workspace files | per api, a merged raw tree (api, base, shared file, packs, includes, `$file` content), each name resolved in the layers that may see it (ADR 0002 section 2) and the source map; pitfalls refused (ADR 0002 section 3) |
| validate | stage | the raw tree | the raw tree checked against the authoring JSON Schema; refused schema keywords reported with ADR 0003's reasons |
| tree | pass | the raw tree | the draft IR fields listed below |
| access | pass | the raw tree and tree's fields | its fields |
| derive | pass | the raw tree and the fields of tree and access | its fields |
| link | workspace pass, built with derive | the IRs of every api, and the IRs of pinned bundles | diagnostics only: `relays` superset checks |
| finalize | stage, built with the seam | a complete draft IR | canonical ids and ordering, the id collision check, validation against the IR JSON Schema, the serialised IR and its side table (ADR 0004) |

The order is fixed. Each api of a workspace runs through derive on its own, in relay order: an api with relay routes runs after every workspace api they name, because its tree pass copies the public operations from that api's derived IR (an imported api's IR comes from its pinned bundle). Relays that form a cycle between apis are a compile error naming them. Link then sees all of them. A step that reports an error stops the pipeline after it completes, so later passes always receive consistent input, while every error of the failing step is still reported at once.

The load stage's trust model: contract files and the packs installed beside them are trusted like any dependency the user chooses to install, as an npm package, an ESLint or a Babel plugin is (a pack, unlike those, is data only). The loader keeps what is a correctness or safety guarantee whoever wrote the files:

- root containment: nothing outside the workspace root, or outside a pack's package directory, is read, through links and `../` included;
- prototype keys refused: `__proto__`, `constructor` and `prototype` are refused as keys and api names, so a raw tree is plain data;
- a depth limit, a per-file size limit and a per-load budget of work and text, which turn a runaway include or expansion into a located error instead of a hang.

Its non-goals: defending against an adversarial contract or pack author, and denial of service beyond those limits, which are not tuned against a hostile author. A pitfall of ADR 0002 section 3 is a diagnostic that keeps the YAML an author means the YAML the compiler reads, not a defence.

### 2. The pass interface (amendment 2026-10-12, p2-pipeline)

Each of the three api passes runs as two halves, each a `PassPart`:

```ts
export type HalfName =
  'tree.schemas' | 'tree.nodes' | 'access.identity' | 'access.rights' | 'derive.wire' | 'derive.errors';
export interface PassPart<H extends HalfName> {
  pass: PassOf<H>;                          // 'tree' | 'access' | 'derive'
  half: H;
  reads: DraftField[];                      // draft-IR paths, e.g. 'operations[].requires'
  writes: DraftField[];
  run(draft: DraftIR, context: PassContextOf<H>): PassResultOf<H>;
}
export interface PassContext {
  raw: RawApi;                              // read-only, with origins
  workspace: RawWorkspace;                  // read-only
  conventions: ResolvedConventions;         // read-only, with origins
  inherited<S extends SettingName>(node: TreeNode, setting: S): Inherited<S> | undefined;   // value plus origin
  origin(pointer: string): Origin | undefined;
  relayed(api: string): DraftIR | undefined;     // read-only: a workspace api's derived draft, closed types
  imported(api: string): ContractIR | undefined; // read-only: an imported api's IR, open reader types
  report(diagnostic: Diagnostic): void;
}
type PassContextOf<H> = H extends 'tree.schemas' ? PassContext : PassContext & { treeSchemas: TreeSchemaService };
type PassResultOf<H> = H extends 'tree.schemas' ? TreeSchemaService : undefined;
export interface WorkspacePass {            // link: diagnostics only
  name: 'link';
  reads: DraftField[];
  run(apis: ReadonlyMap<string, DraftIR>, context: WorkspacePassContext): void;
}
```

- The halves run in the order `tree.schemas`, `tree.nodes`, `access.identity`, `access.rights`, `derive.wire`, `derive.errors`, and each is a step of the stop rule (section 1): a half that reports an error completes, and no later half of that api runs. Each half runs after every half it reads: `tree.nodes` uses the type uses of `tree.schemas`, `access.rights` the access `access.identity` resolved, `derive.wire` both access halves, and `derive.errors` what `derive.wire` wrote (idempotency, cache, concurrency, paging parameters) instead of computing the triggers again.
- `tree.schemas` hands every later half its `TreeSchemaService` by return value (amendment 2026-10-13: not only `tree.nodes`), the one value a half returns: the type use and the query wire form of the schema written at a raw pointer, and an example check against a use. Every inline schema is hoisted during `tree.schemas`' run; the service never writes and reports nothing.
- A half writes only the fields it declares, and only the fields section 3 gives its pass; the field-ownership table splits them between the halves of a pass (ownership moves between passes only by a change to this ADR). A field is owned by one half, or shared in one of two modes: `elements`, a list several halves append to, where an element without `derivedFrom` is the declaring half's and a derived one belongs to the half that owns its derivation (section 5); and `default`, a value written only where still absent, by the halves listed, in run order (`unknownKeys` on a body input use, `maturity`).
- In tests, the draft IR is wrapped in a guard so that a read or a write outside the half's declaration or its ownership throws; a half's tests therefore fail on the first such access, not at merge time. The guard catches mistakes of the project's own passes, not an adversary, and is off outside tests.
- `relayed` returns a workspace api's derived draft in the closed writer view; `imported` returns an imported IR in the open reader types, since it may come from another compiler version. Code that copies a declaration or an operation from an imported IR narrows it with `checkIrClosedDeclaration` (`@seampact/spec/ir`), which lists every unknown union arm, open-enum value and member by pointer, and reports each one by name instead of copying it.
- `inherited` is the single inherited-setting mechanism, shared by tree, access and derive (which reads node `errors` and `errorRoles` through it). It applies the merge rules of ADR 0002 section 8 and returns the origin of the node that set the value.
- The seam PR (merged first in phase 2) holds the interface, `inherited`, the field ownership table below, and two hand-written draft-IR fixtures of the reference contract: after tree, and after tree and access. They are the contract between the three passes; each pass's golden tests start from the fixture before it.

### 3. Field ownership (amendment 2026-10-12, p2-pipeline; amendment 2026-10-13, irRevision 2)

| Pass | Writes |
|---|---|
| tree | `api`, `conventions`, `lint`, `packs`, `formats`, `pagings`, `schemas` (with the version property that a body version source adds to an input schema, after the authored ones, derived from concurrency.version; an input schema used by a route with a body version source and by a route without the same one is a compile error naming the schema and both routes, fixed by declaring two schemas), `scalars`, `enums`, `services`, `extensionKeys`; per operation: `id`, `name`, `surface`, `op`, `resource`, `method`, `path`, `safe`, declared `params`, `unknownQuery`, `input` (schema, media, and `fields`, the per-field wire forms of a form or multipart input), declared `responses` and their `shape`, `owner`, `concurrency` (declared), `paging` (kind, limits, sort keys without rights), `degradable`, `budgetMs`, `deprecated`, `relays` and the shape a relay route copies (method, path, params, input, responses, paging, concurrency, format, and the declarations they use), `upstream`, `maturity` (stated), `internal`, `tags`, `examples`, `format`, `docs`, `extensions`, `origin` |
| access | `schemes`, `headers`, `identities`, `rights`, `rules`, `scopes`, `buckets`; per operation: `access`, `callerKinds`, `principalRequires`, `scopes`, `requires`, `bindings`, `fieldRights`, `paging.sortKeys[].right`, `filteredBy`, `csrf`, `input.rawBody`, `unknownKeys` on the input of a signed identity's routes, rule proofs: header parameters (derived `params`) and body fields (`input.proofs`), and, on a route without an input, the proof-only input that holds them, written where tree left it absent (`input.media`, `input.schema`, `input.rawBody`, `input.origin`: JSON, the core empty schema, true on a signed identity's route (as derivation signed.identity writes it) and false elsewhere, and the first requirement, in requirement order, that brings a body proof, with a signed identity's `unknownKeys` copied onto it with its derivation; ADR 0002 section 9, ADR 0004 section 13); requirements and rights derived by pack entries |
| derive | `errors`, `natures`; per operation: `errors` (a relay route's copied domain codes included), `unknownKeys` on each body input use that sets none, from `conventions.input.unknownKeys` (derivation `input.unknownKeys`), derived `params`, derived `responses` and headers, `input.bodyLimitBytes`, `idempotency`, `concurrency.derivedFrom`, `cache`, `maturity` (derived), `deadlineHeader`; error codes attached by pack entries |
| link | nothing |

Finalize writes `irVersion`, `irRevision`, `kinds` and `features`, and each operation's `features`, computed from the members present (ADR 0005), so no pass writes them.

What each pass checks, besides its writes:

- tree: `conventions.ops` and `conventions.operationIds` applied before operation ids are checked, `codeName` and `codeNames` segments, path versions and prefixes (and `pathVersion`, with a string `api.version` only where every surface has none), operation id uniqueness, one operation per method and full path (the prefix and version applied, placeholders compared by position, not name; relay routes are checked once their path is copied), `ops` inputs, version fields of `concurrency`, list routes and their paging style or its absence (A31), templates against the slot catalogue and each operation's payload (ADR 0002 sections 13 and 14), `idProperty` naming an item property, examples parsed against their schemas (FR-3), enum sources, reasons and narrowings (FR-29), degradable paths optional (FR-32), schema shapes (ADR 0003), `pick` and `omit` sources, fields and overlays, merged into plain objects, scalar names that are not portable format names, `unknownKeys` on input uses only, opaque values outside query, path and header positions, `unknownQuery` and `conventions.query.unknownKeys`, form and multipart inputs (form fields of query kinds or JSON text, files only in multipart or as a download, each file's `maxSize` within the route's body limit), redirect statuses without a body, path segments and query fields stricter than ADR 0002 (`path-segment`, `query-field`, a query field named like a path parameter), `no-content-body`, `responses-output` and query or path `param-unique`, header-tagged unions only as a route's whole input and their header not declared again.
- access: deny by default (FR-4), every exception's reason, `onRefused` only beside `optionalAuth`, a signature scheme's keys against its `verify` form, a query scheme's parameter not declared as a query field, `requirements` entries named in `requires`, pack `derive` selectors and templates, right names against `conventions.rights.pattern`, a right name that yields no identifier segment and has no `codeName` (ADR 0007 section 2), identity header uses against their declarations, service api rules (FR-8), guest rights on public routes, subject sources against id schemas, scope subjects and nesting (FR-22, FR-24), sortable rights against field rights (FR-23), body proofs on body-less routes and bucket key sources against the route's input and access (FR-41), a body proof on an input that is not a `ref` to an object schema (a union, map, array or scalar input is an error naming the rule and the route, ADR 0004 section 13), body proof names (one element per name, shared by rules that read it with the same schema; a different schema under one name, or a name of a property of the input schema or of a form field, is an error naming both origins, ADR 0004 section 13), field-right subjects (FR-23), scheme references (FR-27).
- derive: a derived parameter or response header whose name a declared element or another derivation already takes (header names compared case-insensitively), error registry redefinitions (FR-6) and conflicting node declarations ([A35](../decisions.md#a35)), codes against `conventions.errors.pattern`, natures mapped onto a base, error formats that write `$code`, error examples against the operation's codes and their params, role bindings to unregistered codes or codes that cannot receive the role's required data, deprecation successors, bucket limits (a warning).
- tree, for relay routes: the named api and operation exist, the route name is the public operation id unless `operationId` is set, no other shape key is written, and a copied declaration equals any declaration of the same name in this api.
- finalize: besides the id collision check of ADR 0004 section 9, which also covers the input name of each operation whose input carries body proofs (`{ segments: <the operation's name segments>, role: input }`, computed from the operation's `name`; the operation's own hoisted inline input already has that name and is no collision, ADR 0004 section 13), every name that becomes a key of `components.schemas` in a document is distinct: an error code equal to a schema id, declared or derived (a hoisted inline schema), or to `<schema id>.input` (the strict input component of ADR 0004 section 12) is a compile error naming the code and the schema, with the fix "rename the code". The check holds for every document option, so a document never depends on an option to stay valid.
- link: the `relays` superset. The shape (operation id unless `operationId` renames it, path after the prefix, body, paging, success responses) is copied, so only the codes can differ: every code of the public operation outside the gateway's own derivations (ADR 0002 section 7) must be a code of the relay route. A failure names both operations, the missing code and the fix, or the missing api or operation (FR-8, SCN-014).

### 4. Diagnostics

```ts
interface Diagnostic {
  severity: 'error' | 'warning';
  rule: string;                             // 'seampact/access/deny-by-default'
  message: string;                          // what is wrong, in one sentence
  fix: string;                              // what to write instead, in one sentence
  origin: Origin;                           // turned into file:line:col through the side table
  related: { origin: Origin; message: string }[];   // the other location of a conflict
}
```

The CLI prints one line per diagnostic in the form editors read, then the related locations indented:

```text
tasks/api.yaml:42:9: error seampact/access/deny-by-default: route 'exportTasks' has no identity and no public access. Fix: set 'identity: <name>' on it or an ancestor, or 'access: { public: "<reason>" }'.
```

- Rule ids are `seampact/<step>/<rule>` in kebab case; they are stable, documented, and used by `lint.allow` only for lint rules, never to silence a compile error.
- The relay order of section 1 reports under the step `workspace`: a relay cycle is `seampact/workspace/relay-cycle`, one error per api of the cycle at its relay route, the other apis' routes related; an api relaying to itself is a cycle of one api.
- Diagnostics are sorted by file, line, column, then rule, so the output is deterministic.
- Each origin resolves through one side table (ADR 0004 section 11). The load stage's diagnostics and every diagnostic on the workspace entry file resolve through `RawWorkspace.locations`: the entry document's pointers under `workspace#<pointer>`, a key the compiler spells in one place (`entryLocationKey`), and the load sites under `<layer>#/~load/<file>/<line>/<column>`, a set no entry pointer meets, as none starts `/~load/`. Every other diagnostic belongs to one api and resolves through that api's `RawApi.locations`. The pipeline returns the workspace table beside the per-api tables, so a consumer looks a workspace diagnostic up in the first and an api's in its own. A workspace whose entry is a single api file has no entry document: the workspace part of the validate stage's result is empty, and that file's diagnostics are its api's.
- Warnings do not fail `compile`; `compile --strict`, which CI uses, fails on them. A lint rule's severity comes from `lint.rules` (ADR 0002 section 12): `error` fails `compile`, `disabled` never runs, and a `lint.allow` on an element or an ancestor silences the rule there.
- Lint rules (FR-12) report through the same structure, with ids `<plugin>/<rule>`.
- `seampact explain` (ADR 0002 section 16) turns the same origins and `derivedFrom` into file and line comments on an operation's every element, so the answer to "where does this code come from" is the one the diagnostics use.

### 5. The derivation table

Every derived element carries `derivedFrom: { derivation, from }` with a derivation id from this table (ADR 0004). The table is data in `@seampact/compiler`; the derive pass applies it, targets render its results and never re-derive.

| Derivation id | Trigger | Derived | Role |
|---|---|---|---|
| `input.invalid` | any input: path, query, headers or body | 400 | `schemaInvalid` |
| `body.limit` | a request body | `input.bodyLimitBytes` (route, then `batch`, then `conventions.bodyLimit`, 1 MiB by default), 413 | `payloadTooLarge` |
| `body.media` | a request body | 415 for a media other than the route's `inputMedia` | `unsupportedMediaType` |
| `identity.authenticate` | identity or optional access | credential parameters of the accepted schemes, 401 (on optional access, only with `onRefused: reject`) | `unauthenticated` |
| `csrf.cookieWrite` | a non-safe operation whose write schemes include a cookie scheme that declares `csrf` (opt-in, [A34](../decisions.md#a34)), not `csrf.exempt` | the CSRF header parameter, 403 | `csrfInvalid` |
| `idempotency.write` | a non-safe operation when `conventions.idempotency` is set (opt-in, A34) and its `methods` lists the method, not exempt, not under a signed identity | the key header parameter (required unless `required: false`, a missing key answering 400); with `enforce: boundary` also the replay response header, 422 for a key reused with another request, 409 while the first run is in progress | `idempotencyKeyReused`, `idempotencyInProgress`, `schemaInvalid` |
| `concurrency.version` | `update`, `delete`, or `concurrency: inherit`, on a versioned resource | the query or header version parameter, typed like `field` (a body source on a DELETE becomes the query parameter of the same name, [A33](../decisions.md#a33); any other body source's version property is tree's, section 3), `ETag` from `field` with `header.If-Match`; 409 for a body or query version, 412 for a stale `If-Match` and 428 for a missing one | `stateConflict`, `preconditionFailed`, `preconditionRequired` |
| `member.notFound` | a route below a collection's `member` scope, nested resources included, whose path holds a member id that no scope of the operation reads: the client chose that id, and no resolver answers for it (a scope's membership codes answer an id it reads, `scope.errors`) | 404, answered by the handler through its typed error result (ADR 0012) | `notFound` |
| `owner.caller` | a member route of a collection with `owner: caller` | 404 for another caller's id, answered by the handler through its typed error result | `notFound` |
| `principal.requires` | `principal.requires` | 403 | `forbidden` |
| `binding.mismatch` | `bindings` | 403 | `forbidden` |
| `requirement.errors` | each requirement | the right's or rule's codes | declared |
| `scope.errors` | each scope of the operation | the scope's membership codes | declared |
| `fieldRight.restricted` | a `restrictedTo` property reachable from the operation's input or output, on a route that is not a relay route (a relay route has none, ADR 0002 section 7) | a `fieldRights` entry per pointer and direction, with the subject derived from the right's declaration (ADR 0003 section 6); on input with `reject`, 403 | `forbidden` |
| `sortKey.restricted` | a sortable key with a right, given or inherited from its field | the key's right, 403 | `sortKeyForbidden` |
| `rule.proof` | a requirement on a rule with `proof` | the proof field added once to the input, sensitive | none |
| `rule.bucket` | a requirement with `bucket` | the rule's codes, the retry header on 429 (`conventions.rateLimit`: its `param` in its `unit`) | `rateLimited` |
| `identity.header` | each identity header for the operation's direction and read or write | request parameters and response headers | none |
| `identity.deadline` | a `deadline` identity header | `deadlineHeader`, 504 | `deadlineExceeded` |
| `identity.versionToken` | a `versionToken` identity header | the response header on every success, the optional request header on writes, the declared stale code | declared |
| `signed.identity` | a signed identity | `input.rawBody`, no CSRF, no idempotency key, 401 (with `verify: application`, for a missing signature header and for the hook's refusal) | `unauthenticated` |
| `identity.unknownKeys` | a signed identity with `unknownKeys` | `unknownKeys` (`ignore` or `keep`) on each `ref` input of its routes | none |
| `input.unknownKeys` | `conventions.input.unknownKeys` other than `refuse` | `unknownKeys` on every body input use that sets none | none |
| `union.headerTag` | a route whose input is a header-tagged union (ADR 0003 section 3) | the required tag header parameter, its values the union's tags; 400 on a missing or unknown tag | `schemaInvalid` |
| `cache.headers` | `cache` on a GET | `Cache-Control` per caller kind from the family's directives (shared-cache directives on public values only), `Vary` (the credential headers of the identity's schemes, then `cache.vary`) | none |
| `cache.etag` | `cache.etag` | `ETag` response header, `If-None-Match` parameter, a 304 response | none |
| `cache.sensitive` | a response whose payload holds a sensitive field, on a route with no `cache` or `freshness: never` (a cache family there is a compile error, ADR 0002 section 10) | `cache.noStore` | none |
| `paging.params` | a list with a paging style | the style's request parameters (with `maxLimit` bounds and, for `since`, the token type), the sort parameter when `sortable`, the `page` response shape with the style's headers and `Link` relations, 400 above `maxLimit` unless `overLimit: clamp`, and when both `after` and `before` are sent | `schemaInvalid` |
| `paging.gone` | a paging style with a `since` role | 410 | `gone` |
| `batch.read` | the `batch` op | `safe`, the ids input with `maxIds`, the table shape, batch defaults | none |
| `budget.timeout` | `budget` | `budgetMs` | none |
| `deprecation.headers` | `deprecated` | the deprecation, sunset and successor `Link` response headers, named by `conventions.deprecation` (RFC 9745, RFC 8594 and `successor-version` by default) | none |
| `upstream.maturity` | `upstream` | `maturity` from the owning service | none |
| `relay.route` | a relay route (ADR 0002 section 7) | the public operation's method, path, parameters, input, success responses, paging, concurrency and format, and its domain codes (node and pack attachments, `notFound`) with their declarations | declared |
| `api.gateway` | `api.role: gateway` | 502, 503, 504 on every operation | `upstreamUnavailable`, `serviceUnavailable`, `upstreamTimeout` |
| `api.service` | `api.kind: service` | 504 on every operation | `deadlineExceeded` |
| `response.undeclared` | every operation | 500 | `undeclaredStatus` |
| `response.format` | every response but a download or a redirect | the format reference and shape; `degradable` fills the format's degraded slot or `conventions.degradedHeader` | none |
| `response.download` | a file response body | `Content-Type` from the file's media, `Content-Disposition` when the handler names a file (tree writes the `binary` shape, section 3) | none |
| `redirect.location` | a redirect status in `responses` | the required `Location` header, a `uri-reference` (tree writes the `redirect` shape, section 3) | none |
| `conventions.every` | `conventions.errors.every` | the attached codes | declared |
| `node.errors` | `errors` on a tree node (A35) | the codes it declares or attaches, on every operation below it | declared |
| `pack.<pack>.<entry>` | a pack derivation entry (ADR 0008) | a right, a requirement or attached codes | declared |

Readings of the rows above. The `union.headerTag` parameter is a plain string; its values are read from the union's variants. The `identity.versionToken` request header is optional unless the use sets `required: true`. "Every success" (`idempotency.write`, `identity.header`, `identity.versionToken`) means every 2xx response: a 304 or a redirect carries no derived response header, and a replayed handler error carries no replay header, since an error reply has no header slot ([IR section 7](../ir/07-the-operation.md)). The `idempotency.write` replay header is an optional boolean response header. On optional access, the parameters of `identity.authenticate`, `csrf.cookieWrite`, `identity.header` and `identity.versionToken` and the `identity.versionToken` response header are optional on the wire: an anonymous caller has no principal (ADR 0012), and the identity entry keeps each use's authored requirement for the requests that carry a credential.

### 6. Roles and their default codes

A role is what a derivation answers with an error code (ADR 0002 section 11). Every role has a default code in the core, listed below, so a contract with no pack compiles (A34). The default codes form part of every api's registry, each with the status, nature and params below, and any node may attach one by name. A contract or pack may declare a default code itself to add a title, an example or docs; one that changes its params must bind the role to it explicitly, with `params` when the role's data does not fit by name.

A role is renamed for the whole api by `conventions.errors.derived`, possibly from a pack, and for a subtree by `errorRoles` on any node of the tree; per operation, the nearest binding wins, then the conventions, then the default (A35). Each derived error's `derivedFrom` names the derivation and, besides its trigger, the origin of the binding that chose its code.

The Data column lists what the boundary produces for each role. A datum marked required must reach a param of the bound code, by name or through the binding's `params` template; otherwise the binding is a compile error naming the role, the datum and the code (ADR 0002 section 11).

| Role | Default code | Status | Nature | Data, and the default code's params |
|---|---|---|---|---|
| `schemaInvalid` | `api.schema_invalid` | 400 | refused | `issues` (required): a list of `{ in, pointer, rule }`, where `in` is `path`, `query`, `header` or `body` |
| `unauthenticated` | `api.unauthenticated` | 401 | refused | none |
| `forbidden` | `api.forbidden` | 403 | refused | `pointer`: the restricted input field; required on an operation with a rejected restricted input field, absent otherwise |
| `csrfInvalid` | `api.csrf_invalid` | 403 | refused | none |
| `sortKeyForbidden` | `api.sort_key_forbidden` | 403 | refused | `key` (required) |
| `notFound` | `api.not_found` | 404 | refused | none |
| `stateConflict` | `state.conflict` | 409 | refused | none |
| `idempotencyInProgress` | `api.idempotency_in_progress` | 409 | unavailable | none |
| `preconditionFailed` | `api.precondition_failed` | 412 | refused | none |
| `idempotencyKeyReused` | `api.idempotency_key_reused` | 422 | refused | none |
| `preconditionRequired` | `api.precondition_required` | 428 | refused | none |
| `gone` | `api.cursor_too_old` | 410 | refused | none |
| `payloadTooLarge` | `api.payload_too_large` | 413 | refused | `limitBytes` |
| `unsupportedMediaType` | `api.unsupported_media_type` | 415 | refused | none |
| `rateLimited` | `api.rate_limited` | 429 | unavailable | `retryAfterMs`; required when `conventions.rateLimit` names it |
| `undeclaredStatus` | `api.internal` | 500 | failed | none |
| `upstreamUnavailable` | `api.upstream_unavailable` | 502 | unavailable | none |
| `serviceUnavailable` | `api.service_unavailable` | 503 | unavailable | none |
| `upstreamTimeout` | `api.upstream_timeout` | 504 | unavailable | none |
| `deadlineExceeded` | `api.deadline_exceeded` | 504 | unavailable | none |

A rule with `bucket: true` declares its own codes; when it declares none, it answers the `rateLimited` role.

#### Error declarations on the tree

Codes declared on tree nodes (A35) are collected by the derive pass: it walks every node's `errors` through `inherited`, registers each declaration in `errors` with the node as its origin, and refuses a code declared twice with different definitions, naming both locations. An attachment (`{}` or `{ example }`) of a code that no layer and no node declares, and that is not a default code, is a compile error naming the code. Per operation, `errors` is the union of the codes attached at the api level (`conventions.errors.every`), at every ancestor whose attachment reaches it (`reach` and `for`, ADR 0002 section 11) and at the route, plus the derived ones; each keeps the origin of the node that attached it, and the nearest narrowed example wins.

### 7. The `bare` format

The default wire format (A30), as fixed members so every target writes the same bytes. ADR 0002 section 15 writes it as format data.

- Success: the bare payload for every shape: the item, the id-keyed object of a table, the array of an unpaged list, and the item array of a page. `bare` declares no paging style and no `$meta`: a paged list adds the headers and links of the style it names, or takes the style's whole body, and a paged list with neither a style nor a pack fails to compile (A31, ADR 0002 sections 10 and 14).
- Error: `Content-Type: application/problem+json` (RFC 9457), with members:

| Member | Value |
|---|---|
| `type` | the error code, as a relative URI reference (`api.forbidden`) |
| `title` | the error's `title`, or its code |
| `status` | the HTTP status |
| `detail` | optional text from the handler or hook; never parsed by a client |
| `instance` | optional, a reference to this occurrence |
| `code` | the error code; the member every client discriminates the error union on |
| `nature` | the error's nature, as declared (a base, or a name of the `natures` catalogue) |
| `traceId` | optional, the request's trace id |
| one member per param | each declared param of the code, at the top level as RFC 9457 extension members |

  An optional member with no value is omitted. A param named like one of the members above is a compile error under the `bare` format, as any `$merge` collision is (ADR 0002 section 13).
- `degradable` under `bare` needs `conventions.degradedHeader`; without it the operation fails to compile, naming the fix.

Any other format and every paging style declare their own members, parameters and headers through their templates (ADR 0002 sections 13 and 14, ADR 0004 section 8).

## Consequences

- The seam PR of phase 2 (interface, `inherited`, field table, two draft-IR fixtures) must merge before work on the three passes starts against it.
- A pass needing a field another pass owns cannot take it; ownership moves only by a change to this ADR's table.
- Adding a derivation is a row in the table and an IR change under ADR 0005 when it needs a new member; targets learn of it through the IR, never through compiler code.
- The `bare` format's member names are now part of every server and client target's behaviour; changing one is a breaking change of the wire, recorded in an ADR.
- The core fixes no page shape and no paging parameter name: every paged list names a style, so a contract without a pack writes one before its first list compiles (A31).
- Default codes let a contract compile without a pack (A34); a contract with its own codes binds roles explicitly, for the api or for a subtree (A35).

## Traceability

- FRs: FR-1 (located diagnostics with rule and fix), FR-6 (derivation table, roles, registry), FR-7, FR-8 (relays in link), FR-9, FR-20, FR-22 to FR-24, FR-28, FR-31 to FR-34, FR-41, FR-42 and A30 (the `bare` format), A31 (no default page), A34 (default codes), A35 (errors on tree nodes), FR-37 (field ownership protects the seam).
- CHK items enabled: CHK-007, CHK-011, CHK-015, CHK-016, CHK-029, CHK-030 to CHK-043, CHK-044 to CHK-046, CHK-052, CHK-055, CHK-058, CHK-073, CHK-124, CHK-125, CHK-127, CHK-128, CHK-131, CHK-133, CHK-134, CHK-137 to CHK-139, CHK-149 to CHK-153, CHK-172 (codes against schema component keys), CHK-173 (rights without segments).

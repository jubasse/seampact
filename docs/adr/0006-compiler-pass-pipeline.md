# ADR 0006: Compiler pass pipeline and derivation table

Status: accepted

## Context

Phase 2 builds the semantic compiler in three parallel lanes, one pass each (brief section 15): tree, access and derivation. Parallel lanes on one compiler need a seam that is merged first: a pass interface, a fixed order, and a rule for what each pass may read and write, so that two lanes never edit the same field (the devil's advocate review, risk 4; COMP-Pipeline). Derivation is data, not code scattered in targets (brief section 8): the table that says which declaration derives which element must be written down once. And diagnostics are a feature (brief section 17.1): every one names the file, the line, the column, the rule and the fix (FR-1).

ADR 0008 leaves two values to this ADR: the default code of each derivation role, and the member names of the RFC 9457 error body of the default `bare` format (A30).

## Options

1. One monolithic compiler function, split later.
2. A plugin pipeline where each pass may read and write the whole draft IR.
3. A fixed sequence of passes, each declaring the draft-IR fields it reads and writes, with the declaration enforced in tests, plus a derivation table held as data.

Option 1 cannot be built by three lanes at once. Option 2 lets passes overwrite each other's fields, so a lane's tests pass alone and fail once merged. Option 3 is chosen.

## Decision

### 1. Stages and passes

```text
load -> validate -> tree -> access -> derive -> link -> finalize
```

| Step | Kind | Input | Output |
|---|---|---|---|
| load | stage (p1-loader) | the workspace files | per api, a merged raw tree (api, base, packs, includes, `$file` content) and the source map; pitfalls refused (ADR 0002 section 3) |
| validate | stage (p1-spec) | the raw tree | the raw tree checked against the authoring JSON Schema; refused schema keywords reported with ADR 0003's reasons |
| tree | pass (p2-tree) | the raw tree | the draft IR fields listed below |
| access | pass (p2-access) | the raw tree and tree's fields | its fields |
| derive | pass (p2-derive) | the raw tree and the fields of tree and access | its fields |
| link | workspace pass (p2-derive) | the draft IRs of every api, and the IRs of pinned bundles | diagnostics only: `relays` superset checks |
| finalize | stage (COMP-Pipeline) | a complete draft IR | canonical ids and ordering, the id collision check, validation against the IR JSON Schema, the serialised IR and its side table (ADR 0004) |

The order is fixed. Each api of a workspace runs through derive on its own; link then sees all of them. A step that reports an error stops the pipeline after it completes, so later passes always receive consistent input, while every error of the failing step is still reported at once.

### 2. The pass interface

```ts
export interface Pass {
  name: 'tree' | 'access' | 'derive' | 'link';
  reads: DraftField[];                      // draft-IR paths, e.g. 'operations[].requires'
  writes: DraftField[];
  run(draft: DraftIR, context: PassContext): void;
}
export interface PassContext {
  raw: RawTree;                             // read-only, with origins
  conventions: ResolvedConventions;         // read-only, with origins
  inherited<T>(node: TreeNode, setting: SettingName): Inherited<T> | undefined;   // value plus origin
  report(diagnostic: Diagnostic): void;
}
```

- A pass writes only the fields it declares. In tests, the draft IR is wrapped so that a read or a write outside the declaration throws; a lane's tests therefore fail on the first undeclared access, not at merge time (COMP-Pipeline).
- `inherited` is the single inherited-setting mechanism, shared by tree and access. It applies the merge rules of ADR 0002 section 8 and returns the origin of the node that set the value.
- The seam PR (COMP-Pipeline, merged first in phase 2) holds the interface, `inherited`, the field ownership table below, and two hand-written draft-IR fixtures of the reference contract: after tree, and after tree and access. They are the contract between the three lanes; each lane's golden tests start from the fixture before it.

### 3. Field ownership

| Pass | Writes |
|---|---|
| tree | `api`, `conventions`, `packs`, `formats`, `schemas`, `scalars`, `enums`, `services`, `extensionKeys`; per operation: `id`, `name`, `surface`, `op`, `method`, `path`, `safe`, declared `params`, `input` (schema and media), declared `responses` and their `shape`, `owner`, `concurrency` (declared), `paging` (kind, limits, sort keys without rights), `degradable`, `budgetMs`, `deprecated`, `relays`, `upstream`, `maturity` (stated), `internal`, `tags`, `examples`, `format`, `docs`, `extensions`, `origin` |
| access | `schemes`, `identities`, `rights`, `rules`, `scopes`, `buckets`; per operation: `access`, `callerKinds`, `principalRequires`, `scopes`, `requires`, `bindings`, `fieldRights`, `paging.sortKeys[].right`, `filteredBy`, `csrf`, `input.rawBody`, rule proofs added to `input`; requirements and rights derived by pack entries |
| derive | `errors`, `natures`; per operation: `errors`, derived `params`, derived `responses` and headers, `input.bodyLimitBytes`, `idempotency`, `concurrency.derivedFrom`, `cache`, `maturity` (derived), `deadlineHeader`, `features`; error codes attached by pack entries |
| link | nothing |

What each pass checks, besides its writes:

- tree: path versions and prefixes, operation id uniqueness, `ops` inputs, version fields of `concurrency`, examples parsed against their schemas (FR-3), enum sources, reasons and narrowings (FR-29), degradable paths optional (FR-32), schema shapes (ADR 0003).
- access: deny by default (FR-4), every exception's reason, service api rules (FR-8), guest rights on public routes, subject sources against id schemas, scope subjects and nesting (FR-22, FR-24), sortable rights against field rights (FR-23), body proofs on body-less routes (FR-41), scheme references (FR-27).
- derive: error registry redefinitions (FR-6), unbound or unregistered roles, deprecation successors, bucket limits (a warning).
- link: the `relays` superset (operation id, path shape after the prefix, body, paging, success responses, and the public codes minus the gateway's own), naming both operations and the missing element, or the missing api (FR-8, SCN-014).

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
- Diagnostics are sorted by file, line, column, then rule, so the output is deterministic.
- Warnings do not fail `compile`; `compile --strict`, which CI uses, fails on them.
- Lint rules (FR-12) report through the same structure, with ids `<plugin>/<rule>`.

### 5. The derivation table

Every derived element carries `derivedFrom: { derivation, from }` with a derivation id from this table (ADR 0004). The table is data in `@seampact/compiler`; the derive pass applies it, targets render its results and never re-derive.

| Derivation id | Trigger | Derived | Role |
|---|---|---|---|
| `input.invalid` | any input: path, query, headers or body | 400 | `schemaInvalid` |
| `body.limit` | a request body | `input.bodyLimitBytes` (route, then `batch`, then `conventions.bodyLimit`, 1 MiB by default), 413 | `payloadTooLarge` |
| `body.media` | a request body | 415 | `unsupportedMediaType` |
| `identity.authenticate` | identity or optional access | credential parameters of the accepted schemes, 401 | `unauthenticated` |
| `csrf.cookieWrite` | a non-safe operation whose write schemes include a cookie scheme with `csrf`, not `csrfExempt` | the CSRF header parameter, 403 | `csrfInvalid` |
| `idempotency.write` | a non-safe operation, not exempt, not under a signed identity | the key header parameter, the replay response header, two 409s | `idempotencyKeyReused`, `idempotencyInProgress` |
| `concurrency.version` | `update`, `delete`, or `concurrency: inherit`, on a versioned resource | 409 | `stateConflict` |
| `owner.caller` | a member route of a collection with `owner: caller` | 404 | `notFound` |
| `principal.requires` | `principal.requires` | 403 | `forbidden` |
| `binding.mismatch` | `bindings` | 403 | `forbidden` |
| `requirement.errors` | each requirement | the right's or rule's codes | declared |
| `scope.errors` | each scope of the operation | the scope's membership codes | declared |
| `fieldRight.restricted` | a `restrictedTo` property reachable from the operation's input or output | a `fieldRights` entry per pointer and direction; on input with `reject`, 403 | `forbidden` |
| `sortKey.restricted` | a sortable key with a right, given or inherited from its field | the key's right, 403 | `sortKeyForbidden` |
| `rule.proof` | a requirement on a rule with `proof` | the proof field added once to the input, sensitive | none |
| `rule.bucket` | a requirement with `bucket` | the rule's codes, the retry header on 429 (`conventions.rateLimit`) | `rateLimited` |
| `identity.header` | each identity header for the operation's direction and read or write | request parameters and response headers | none |
| `identity.deadline` | a `deadline` identity header | `deadlineHeader`, 504 | `deadlineExceeded` |
| `identity.versionToken` | a `versionToken` identity header | the response header on every success, the optional request header on writes, the declared stale code | declared |
| `signed.identity` | a signed identity | `input.rawBody`, no CSRF, no idempotency key, 401 | `unauthenticated` |
| `cache.headers` | `cache` on a GET | `Cache-Control` per caller kind, `Vary` | none |
| `cache.etag` | `cache.etag` | `ETag` response header, `If-None-Match` parameter, a 304 response | none |
| `cache.sensitive` | a response whose payload holds a sensitive field | `cache.noStore` | none |
| `paging.params` | `paging` | the paging query parameters of the format, the page shape, the sort parameter when `sortable` | none |
| `paging.gone` | `changesSince` paging | 410 | `gone` |
| `batch.read` | the `batch` op | `safe`, the ids input with `maxIds`, the table shape, batch defaults | none |
| `budget.timeout` | `budget` | `budgetMs` | none |
| `deprecation.headers` | `deprecated` | `Deprecation`, `Sunset` and `Link` (successor) response headers | none |
| `upstream.maturity` | `upstream` | `maturity` from the owning service | none |
| `api.gateway` | `api.role: gateway` | 502, 503, 504 on every operation | `upstreamUnavailable`, `serviceUnavailable`, `upstreamTimeout` |
| `api.service` | `api.kind: service` | 504 on every operation | `deadlineExceeded` |
| `response.undeclared` | every operation | 500 | `undeclaredStatus` |
| `response.format` | every response | the format reference and shape; `degradable` fills the format's degraded slot or `conventions.degradedHeader` | none |
| `conventions.every` | `conventions.errors.every` | the attached codes | declared |
| `pack.<pack>.<entry>` | a pack derivation entry (ADR 0008) | a right, a requirement or attached codes | declared |

### 6. Roles and their default codes

A role is a slot a derivation answers with an error code. The api binds a role to a code of its registry through `conventions.errors.derived` (ADR 0002 section 11), possibly from a pack. A role left unbound uses its default code below, which the compiler then adds to the api's registry with the default status, nature and params; a contract that registers a different definition under the same code must bind the role explicitly. This amends ADR 0002 section 11, where an unbound role was an error: ADR 0008 gives every role a default so that a contract with no pack compiles (A30).

| Role | Default code | Status | Nature | Params |
|---|---|---|---|---|
| `schemaInvalid` | `api.schema_invalid` | 400 | refused | `issues`: a list of `{ in, pointer, rule }` |
| `unauthenticated` | `api.unauthenticated` | 401 | refused | none |
| `forbidden` | `api.forbidden` | 403 | refused | `pointer?`: the restricted input field |
| `csrfInvalid` | `api.csrf_invalid` | 403 | refused | none |
| `sortKeyForbidden` | `api.sort_key_forbidden` | 403 | refused | `key` |
| `notFound` | `api.not_found` | 404 | refused | none |
| `stateConflict` | `state.conflict` | 409 | refused | none |
| `idempotencyKeyReused` | `api.idempotency_key_reused` | 409 | refused | none |
| `idempotencyInProgress` | `api.idempotency_in_progress` | 409 | unavailable | none |
| `gone` | `api.cursor_too_old` | 410 | refused | none |
| `payloadTooLarge` | `api.payload_too_large` | 413 | refused | `limitBytes` |
| `unsupportedMediaType` | `api.unsupported_media_type` | 415 | refused | none |
| `rateLimited` | `api.rate_limited` | 429 | unavailable | `retryAfterMs` |
| `undeclaredStatus` | `api.internal` | 500 | failed | none |
| `upstreamUnavailable` | `api.upstream_unavailable` | 502 | unavailable | none |
| `serviceUnavailable` | `api.service_unavailable` | 503 | unavailable | none |
| `upstreamTimeout` | `api.upstream_timeout` | 504 | unavailable | none |
| `deadlineExceeded` | `api.deadline_exceeded` | 504 | unavailable | none |

A rule with `bucket: true` declares its own codes; when it declares none, it answers the `rateLimited` role.

### 7. The `bare` format

The default wire format (A30), as fixed members so every target writes the same bytes:

- Success: the bare payload for an item; for a table, the object keyed by id; for a page, the page object of its paging kind:

| Paging kind | Query parameters | Page object |
|---|---|---|
| `cursor` | `cursor`, `limit` | `{ items, nextCursor }` (`nextCursor` null on the last page) |
| `pages` | `page` (from 1), `limit` | `{ items, page, limit, totalItems }` |
| `changesSince` | `since` (an opaque token or a `date-time`) | `{ items, next, complete }` |

  The sort parameter is `sort`, a key or a key prefixed with `-` for descending.
- Error: `Content-Type: application/problem+json` (RFC 9457), with members:

| Member | Value |
|---|---|
| `type` | the error code, as a relative URI reference (`api.forbidden`) |
| `title` | the error's `title`, or its code |
| `status` | the HTTP status |
| `detail` | optional text from the handler or hook; never parsed by a client |
| `instance` | optional, a reference to this occurrence |
| `code` | the error code; the member every client discriminates the error union on |
| `nature` | the error's nature |
| `traceId` | optional, the request's trace id |
| one member per param | each declared param of the code, at the top level as RFC 9457 extension members |

  A param named like one of the members above is a compile error under the `bare` format.
- `degradable` under `bare` needs `conventions.degradedHeader`; without it the operation fails to compile, naming the fix.

Any other format declares its own members and parameters through its templates (ADR 0004 section 8).

## Consequences

- The seam PR of phase 2 (interface, `inherited`, field table, two draft-IR fixtures) must merge before the three pass lanes start coding against it.
- A pass needing a field another pass owns asks the lead; ownership moves only by a change to this ADR's table.
- Adding a derivation is a row in the table and an IR change under ADR 0005 when it needs a new member; targets learn of it through the IR, never through compiler code.
- The `bare` format's member names are now part of every server and client target's behaviour; changing one is a breaking change of the wire, recorded in an ADR.
- Default codes let a contract compile without a pack; a contract with its own codes binds roles explicitly.

## Traceability

- FRs: FR-1 (located diagnostics with rule and fix), FR-6 (derivation table, roles, registry), FR-7, FR-8 (relays in link), FR-9, FR-20, FR-22 to FR-24, FR-28, FR-31 to FR-34, FR-41, FR-42 and A30 (the `bare` format), FR-37 (field ownership protects the seam).
- CHK items enabled: CHK-007, CHK-011, CHK-015, CHK-016, CHK-029, CHK-030 to CHK-043, CHK-044 to CHK-046, CHK-052, CHK-055, CHK-058, CHK-073.

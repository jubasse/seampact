# ADR 0004: IR shape

Status: accepted

## Context

The IR is the seam of the whole project (brief section 15). Every generator, the OpenAPI emitter, lint and diff read it and nothing else; generators written outside the repository, in Kotlin and PHP, read it through models generated from its JSON Schema (FR-40). It must be canonical and fully resolved, deterministic to the byte, versioned, and carry source locations without letting them break byte stability (brief section 10, FR-9).

Inputs this ADR must honour:

- ADR 0002 (grammar) and ADR 0003 (schema language): what the IR resolves.
- FR-9 (fully resolved, deterministic, side table), FR-37 (irVersion and irRevision, additive by design, extension slots, open enums), FR-38 (names as word segments plus a role), FR-40 (generated Kotlin and PHP models), FR-23 (field rights per operation), FR-6 (`derivedFrom` on every derived element).
- ADR 0008 (packs): the IR lists the packs applied; wire formats must express both wrapping and merging envelopes; media types are recorded.
- ADR 0014 (room for real-time and RPC): a top-level list of declaration kinds, declarations at the api level, HTTP operations in their own collection, explicit media types, errors identified by code with the HTTP status as an attribute, kind-tagged operation references, an extension slot on properties.

The brief's sketch (section 10) is the starting point. This ADR fixes the top-level layout, the operation, the requirement union, origins and `derivedFrom`, the side table, canonical ordering and ids, and the byte-stable serialisation. How the IR evolves is ADR 0005; which pass writes which field is ADR 0006; how names become identifiers is ADR 0007.

## Options

1. The brief's sketch as is: a flat record per api with `Record`s of declarations and a sorted operation list.
2. A normalised graph (every node an entity with an id, edges in separate tables).
3. The sketch, extended to the inputs above, with three structural rules: declarations live at the api level and are referenced by id; operations hold everything a target needs without walking schemas; every derived element names where it came from.

Option 2 is harder to read and to generate models from, and pushes joins onto every target. Option 1 misses rights, scopes, formats, field rights, media types and kinds. Option 3 is chosen.

## Decision

### 1. One IR document per api

A workspace compiles to one IR document per api. A cross-api reference (`relays`) names the other api and the operation id; the target api's IR is either a sibling in the same compile or the IR inside a pinned bundle (ADR 0011). The IR is JSON. Its JSON Schema, published in `@seampact/spec`, is written in the subset of ADR 0003 (tagged unions on a `kind` member, no `anyOf`, maps for catalogues), so that the Kotlin and PHP models can be generated from it without hand-written parts (FR-40).

### 2. Top-level layout

```ts
interface ContractIR {
  irVersion: 1;
  irRevision: number;                       // ADR 0005
  kinds: DeclarationKind[];                 // the declaration kinds present: ['httpOperation'] in 1.0
  features: Feature[];                      // must-understand features used by any operation (ADR 0005); empty at 1.0
  api: Api;
  packs: PackRef[];                         // packs applied, in application order, extended packs included: { name, version }
  conventions: Conventions;                 // resolved values, each with its origin
  formats: Record<FormatId, WireFormat>;    // only the formats this api uses, the default included
  pagings: Record<PagingId, PagingStyle>;   // only the paging styles this api uses
  schemas: Record<SchemaId, Schema>;        // named and hoisted inline schemas
  scalars: Record<ScalarId, Scalar>;
  enums: Record<EnumId, Enum>;
  errors: Record<ErrorCode, ErrorDecl>;
  schemes: Record<SchemeId, Scheme>;
  headers: Record<HeaderId, HeaderDecl>;    // identity headers (ADR 0002 section 9)
  identities: Record<IdentityId, Identity>;
  rights: Record<RightId, Right>;
  rules: Record<RuleId, Rule>;
  scopes: Record<ScopeId, Scope>;
  buckets: Record<BucketId, Bucket>;
  services: Record<ServiceId, Service>;
  extensionKeys: Record<ExtensionKeyId, ExtensionKeyDecl>;   // '<prefix>-<key>' to its schema and allowed places
  operations: Operation[];                  // the 'httpOperation' kind, sorted by id
}
```

- `kinds` lists every declaration kind the document uses. A target declares the kinds it supports and refuses an IR with another kind by name, instead of ignoring an unknown collection (ADR 0014, FR-14). A later transport adds a kind and a sibling collection (for example `channels`); it never adds a value to the HTTP method enum.
- Every declaration that an operation uses is at the top level and referenced by id, never nested in an operation, so a later transport reuses the same declarations (ADR 0014).
- Only declarations reachable from an operation, an identity or a convention are kept. Lint reports unused declarations from the source (FR-12), not from the IR.

```ts
interface Api {
  id: string;  name: Name;                  // 'tasks'
  version: number;                          // the path version
  kind: 'surface' | 'service';
  role?: 'gateway';
  maturity: Maturity;                       // 'experimental' | 'provisional' | 'stable'
  caller?: { identity: IdentityId; right: RightId };
  compat: { policy: 'additive-only' | 'none' };
  surfaces: Record<SurfaceId, { name: Name; prefix: string; origin: Origin }>;
  documents: Record<DocumentId, { surfaces: SurfaceId[]; internal: 'include' | 'exclude' }>;
  docs: Docs;  extensions: Extensions;  origin: Origin;
}
```

### 3. Common members

Every IR object of the kinds below has the members it needs from this list, with these meanings:

| Member | Meaning |
|---|---|
| `id` | the stable key: the catalogue name as written, or for a derived element the canonical identifier of its name (section 8) |
| `name` | `{ segments: string[], role: string }`, the canonical name (ADR 0007); never a final identifier |
| `origin` | where it was declared (section 6) |
| `derivedFrom` | present on, and only on, an element the compiler derived (section 6) |
| `docs` | `{ summary?, description? }`, resolved text |
| `extensions` | the extension slot: `{ "<prefix>": { "<key>": value } }`, on every object a consumer may extend (api, operation, schema, property, right, rule, scope) and kept empty elsewhere for later use |

### 4. Declarations

```ts
interface ErrorDecl {
  code: ErrorCode;  family: string;  nature: 'refused' | 'unavailable' | 'failed';
  http: { status: number };                 // the status is an HTTP attribute of the error (ADR 0014)
  params?: SchemaRef;  example?: unknown;  title?: string;  docs;
  origin;                                   // the catalogue entry or the tree node that declared it (A35)
  default?: ErrorRole;                      // set when the code is a role's core default (ADR 0006 section 6)
}
interface HeaderDecl {
  id; semantic: 'deadline' | 'traceContext' | 'actorSurface' | 'versionToken';
  name?: string; in?: 'request' | 'response';   // every semantic but versionToken
  response?: string; request?: string;          // versionToken
  schema?: TypeUse; origin;
}

interface Scheme {
  id; kind: 'cookie' | 'header' | 'bearer' | 'signature';
  name?: string; format?: string; csrf?: SchemeId;
  signature?: { header; format; algorithm; payload; encoding: 'hex' | 'base64'; toleranceMs?: number;
                key: { value: string } | { from: ValueSource } };
  origin;
}
interface Identity {
  id; kind: 'credential' | 'signed';
  schemes: { read: SchemeId[]; write: SchemeId[]; optionalRead: SchemeId[] } | { signed: SchemeId };
  principal: SchemaRef | { variants: Record<VariantId, SchemaRef> };
  errors: ErrorCode[];
  headers: { header: HeaderId; for: 'all' | 'reads' | 'writes'; required: boolean; schema?: TypeUse;
             from?: ValueSource; stale?: ErrorCode; origin }[];   // uses of the headers catalogue
  docs; extensions; origin;
}
interface Right {
  id; params?: SchemaRef;
  subject: { kind: 'none' } | { kind: 'scope'; scope: ScopeId } | { kind: 'resource'; type: Name; idSchema: SchemaRef };
  guest?: Reason;  errors: ErrorCode[];  docs; extensions; origin; derivedFrom?;   // derivedFrom when a pack declared it
}
interface Rule {
  id; params?: SchemaRef; takesBucket: boolean;
  proof?: { in: 'body' | 'header'; name: string; schema: SchemaRef };
  errors: ErrorCode[]; docs; extensions; origin;
}
interface Scope { id; idSchema: SchemaRef; within?: ScopeId; errors: ErrorCode[]; docs; extensions; origin }
interface Bucket { id; key: ValueSource[]; limit?: number; windowMs?: number; origin }
interface Service { id; maturity: Maturity; origin }
interface Enum {
  id; name; values: string[];               // written order kept
  source?: { vocabulary: string } | { enum: EnumId };  localReason?: Reason;  fallback?: string;
  directions: Direction[]; docs; origin;
}
```

Every params of a right, rule or error is a `SchemaRef` to a named object schema (an inline params map is hoisted and named, for example `RolesParams`), so every target gets a named type (FR-22).

### 5. Schemas

```ts
type Schema =                                // a tagged union on 'kind'
  | { kind: 'object'; properties: Property[] }
  | { kind: 'map'; keys?: TypeUse; values: TypeUse }
  | { kind: 'union'; discriminator: string; variants: { tag: string; schema: SchemaId }[] }
  ;                                          // each with id, name, directions, examples, docs, extensions, origin
interface Property {
  name: string; type: TypeUse; optional: boolean; nullable: boolean;
  sensitive: boolean; restrictedTo?: FieldRestriction; default?: unknown; deprecated: boolean;
  docs; extensions; origin;
}
type TypeUse =                               // what a property, item, body or parameter is
  | { kind: 'ref'; schema: SchemaId }        // objects, maps and unions are always named
  | { kind: 'enum'; enum: EnumId; narrowedTo?: { values: string[]; reason: Reason } }
  | { kind: 'scalar'; type: 'string' | 'integer' | 'number' | 'boolean'; format?: string; refinements: Refinements }
  | { kind: 'array'; items: TypeUse; minItems?: number; maxItems?: number };
```

- Objects, maps and unions are always named schemas, hoisted to `schemas` with the deterministic name of ADR 0007; scalars, enum uses and arrays stay inline in their use. Generated code therefore never holds an anonymous structural type (FR-3).
- `allOf` is already merged; a union variant already holds its tag property.
- `directions` lists `input` and `output` as the schema is used; targets generate per-direction validators from it (ADR 0003 section 4).
- `nullable` and `optional` are two members (FR-3, SCN-005).

### 6. Origins and `derivedFrom`

```ts
interface Origin { layer: 'api' | 'base' | `pack:${string}`; pointer: string }
interface DerivedFrom { derivation: DerivationId; from: Origin[] }
```

- `pointer` is a JSON Pointer into the merged authoring tree of its layer: `/surfaces/app/routes/channels/member/routes/tasks/member/routes/assign`, `/rights/tasks.update`, `/conventions/idempotency/header`. It names a logical position, never a file, so moving content between files leaves it unchanged (ADR 0002 byte-identity rule).
- Every declared element has an `origin`. Every inherited setting on an operation carries the origin of the node that set it (FR-2, SCN-003).
- Every derived element carries `derivedFrom`: the derivation id from the derivation table (ADR 0006) and the origins of the declarations that caused it, for example `{ derivation: 'csrf.cookieWrite', from: [/identities/user, /schemes/sessionCookie] }`. A test walks the IR and fails on a derived element without it (SCN-011, CHK-045).

### 7. The operation

```ts
interface Operation {
  kind: 'httpOperation';
  id: string;  name: Name;                   // 'assignTask'
  surface: SurfaceId;
  op?: 'list' | 'get' | 'create' | 'update' | 'delete' | 'batch';   // the ops shorthand it came from
  features: Feature[];                       // must-understand features this operation uses (ADR 0005)
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;                              // '/v1/channels/{channelId}/tasks/{taskId}/assign'
  safe: boolean;                             // a GET, or a batch read sent as POST
  params: { path: Param[]; query: Param[]; header: Param[] };       // declared and derived, each with origin or derivedFrom
  access: Access;
  callerKinds: ('anonymous' | 'identified')[];
  principalRequires: { field: string; origin: Origin }[];
  scopes: { scope: ScopeId; source: ValueSource | { resolver: true }; origin: Origin }[];   // resolution order
  requires: Requirement[];                   // pack-derived (pack, then entry order), then ancestors', then the route's own (ADR 0002 section 8)
  bindings: { from: ValueSource; to: ValueSource; origin: Origin }[];
  input?: { media: string; schema: TypeUse; bodyLimitBytes: number; rawBody: boolean; origin };
  responses: Response[];                     // success and derived non-error responses (304), sorted by status
  errors: { code: ErrorCode; example?: unknown; derivedFrom?: DerivedFrom; origin?: Origin }[];   // origin: the node that attached it (A35)
  fieldRights: FieldRight[];
  idempotency?: { header: string; replayHeader: string; lifetimeMs: number; derivedFrom } | { exempt: Reason; origin };
  concurrency?: { version: ValueSource; field: string; derivedFrom };
  owner?: { kind: 'caller'; origin };
  cache?: Cache;
  paging?: Paging;
  filteredBy?: RightId;
  degradable?: { paths: string[]; origin };
  budgetMs?: number;  deadlineHeader?: string;
  deprecated?: { sunset: string; successor?: OperationRef; origin };
  relays?: OperationRef;
  upstream: ServiceId[];                     // owner first
  maturity: { level: Maturity; source: 'api' | 'upstream' | 'stated'; reason?: Reason; origin };
  internal: boolean;
  csrf?: { header: string; derivedFrom } | { exempt: Reason; origin };
  format: FormatId;
  tags: string[];
  examples: Record<string, { status?: number; request?: true; value: unknown }>;
  docs; extensions; origin;
}

type Access =
  | { kind: 'identity'; identity: IdentityId; schemes: SchemeId[]; origin }
  | { kind: 'optional'; identity: IdentityId; schemes: SchemeId[]; reason: Reason; refusedAsAnonymous?: Reason; origin }
  | { kind: 'public'; reason: Reason; origin };

type Requirement =
  | { kind: 'right'; right: RightId; params?: unknown;
      subject?: { source: ValueSource; defaulted: boolean };
      origin?: Origin; derivedFrom?: DerivedFrom }
  | { kind: 'rule'; rule: RuleId; params?: unknown; bucket?: BucketId;
      origin?: Origin; derivedFrom?: DerivedFrom };

interface Response {
  status: number;
  media?: string;                            // absent for an empty body (204, 304)
  body?: TypeUse;                            // the unwrapped payload
  shape: 'item' | 'table' | 'list' | 'page' | 'empty';   // 'page': the paging style's response; the others: the format's shape
  headers: { name: string; type: TypeUse; required: boolean; semantic?: string; origin?: Origin; derivedFrom?: DerivedFrom }[];
  origin?: Origin; derivedFrom?: DerivedFrom;
}

interface FieldRight {                       // FR-23: materialised so targets never walk schemas
  schema: SchemaId; pointer: string;         // '/effort', '/items/*/effort'
  right: RightId; params?: unknown; subject: 'holder' | 'scope';
  direction: 'input' | 'output'; inputPolicy?: 'reject' | 'strip'; derivedFrom: DerivedFrom;
}

interface OperationRef { kind: 'httpOperation'; api: string; id: string }
type ValueSource = { in: 'path' | 'query' | 'header' | 'body' | 'principal' | 'scope'; name: string }
                 | { in: 'host' | 'subdomain' | 'address' } | { in: 'address'; prefixBits: number };
```

- The operation holds everything a target renders: identity and schemes, CSRF, the ordered requirements, scopes, field rights, headers, errors, idempotency, cache, paging. Targets render and never re-derive (brief section 8).
- `requires` is a union tagged by `kind`, keeping the declared order (FR-5, SCN-009). Each item's `params` are values already validated against the right's or rule's params schema.
- `errors` lists every code the operation can answer, declared or derived, each code once (SCN-011). The status of each is read from the registry; a target builds its status union from `responses` and the statuses of `errors`. The undeclared-status 500 is listed like any other code.
- Operation references carry the declaration kind (ADR 0014), so hook requests and `relays` stay valid when other kinds exist.
- Query parameters carry their wire form: `{ name, type, required, wire: { kind: 'number' | 'boolean' | 'list' | 'text' | 'object'; style: 'form'; explode: boolean }, default?, origin }` (FR-30).

```ts
interface Cache {
  family: string; maxAgeMs: number | null;   // null for 'never' (no-store)
  anonymous: 'public' | 'private'; vary: string[]; etag: boolean;
  perCallerKind: { caller: 'anonymous' | 'identified'; cacheControl: string }[];   // what OpenAPI lists
  noStore: boolean;                          // true when 'never' or a response carries a sensitive field
  origin; derivedFrom?;
}
interface Paging {
  style?: PagingId;                          // absent with 'noneReason': an unpaged list
  maxLimit?: number; defaultLimit?: number; token?: 'opaque' | 'instant'; noneReason?: Reason;
  sortKeys: { key: string; right?: RightId; derivedFrom?: DerivedFrom; origin?: Origin }[];
  origin;
}
```

### 8. Wire formats and paging styles

A wire format (A30, ADR 0008) is data in `formats`, and a paging style (A31) is data in `pagings`, both with the template language of ADR 0002 sections 13 and 14. The core default `bare` appears in `formats` too, like a pack format, so targets handle one model:

```ts
interface WireFormat {
  id: FormatId; origin;
  media: string;                             // 'application/json', 'application/ld+json'
  absent: 'omit' | 'null';
  success: { item: Shape; table: Shape; list: Shape };   // defaults filled: body '$payload', no headers
  meta: Record<string, { type: TypeUse; fill: 'now' | 'traceId' | 'degraded' | 'handler' | ValueSource }>;
  error: { media: string; body: Template; headers: HeaderTemplate[] };   // 'application/problem+json' for 'bare'
}
interface Shape { body: Template; headers: HeaderTemplate[] }
interface HeaderTemplate { name: string; value: Template }

interface PagingStyle {
  id: PagingId; origin;
  position: 'cursor' | 'page' | 'offset' | 'since';
  absent: 'omit' | 'null';
  request: { role: 'cursor' | 'page' | 'offset' | 'since' | 'limit' | 'sort';
             in: 'query' | 'header'; name: string; base?: 0 | 1; style?: 'signed' | 'pair' | 'keyed' }[];
  response: { body: Template; headers: HeaderTemplate[]; links: { rel: string; role: UrlRole }[] };
  handlerResult: ('nextCursor' | 'previousCursor' | 'total' | 'more' | 'nextSince' | 'complete')[];
}
type UrlRole = 'self' | 'first' | 'previous' | 'next' | 'last';

type Template =
  | { kind: 'slot'; slot: Slot; path: string[] }   // '$payload', '$item.taskId' (path ['taskId'])
  | { kind: 'text'; parts: ({ text: string } | { slot: Slot; path: string[] })[] }   // '/contexts/${resource}'
  | { kind: 'literal'; value: unknown }
  | { kind: 'object'; members: { name: string | { slot: Slot }; value: Template }[]; merge?: Slot }
  | { kind: 'array'; items: Template[] }
  | { kind: 'each'; of: Slot; as: Template };
```

An `object` template either wraps (the payload under a member, `{ data: $payload, meta: $meta }`) or merges (`merge: 'payload'`, the payload's own members beside the format's members, as JSON-LD puts `@context`, `@id` and `@type` beside an item's fields). An `each` template maps every element of an array slot, as Hydra's `member`, JSON:API's resource objects and HAL's `_embedded` need. Each response records its media type and its `shape`, so a target finds the template without guessing: `item`, `table` and `list` read the format, `page` reads the operation's paging style. The IR stores the unwrapped payload and the format and style references only; nothing restates the envelope (FR-42). `handlerResult` lists what the handler returns beside the items, so a target types the handler's page result without reading templates. The slot catalogue, the roles and who fills each one are ADR 0002 sections 13 and 14; the members of the `bare` error body (RFC 9457) are ADR 0006 section 7.

### 9. Canonical ids and ordering

- Ids are the catalogue names as written (schemas, enums, rights, codes...). A derived name (an inline schema, a derived operation id) has the id given by ADR 0007's canonical identifier of its segments. A derived id equal to a declared one is a compile error naming both.
- Records (`Record<...>`) are JSON objects; their order is the serialisation order of section 10.
- Arrays keep the written order where order is meaningful, and are sorted otherwise:

| Kept in written or semantic order | Sorted |
|---|---|
| `requires`; `scopes` (resolution order); `upstream` (owner first); enum `values`; `bucket.key`; a union's variants (by tag); template members; `examples` values of a schema; `packs` (application order) | `operations` (by id); `properties` (by name); `errors` (by status, then code); `responses` (by status); `params` (by name); `tags`, `vary`, `callerKinds`, `directions`, `kinds`, `features`; `fieldRights` (by schema, then pointer, then direction); `sortKeys` (by key); `bindings` (by source) |

Object properties are sorted by name because ADR 0002 makes mapping key order meaningless: generated types list fields alphabetically.

### 10. Byte-stable serialisation

The IR file is the IR value serialised as:

- UTF-8, no byte order mark, LF line endings, a final newline;
- object members sorted by the UTF-16 code units of their names (the order of RFC 8785), two-space indentation;
- strings escaped as RFC 8785 does; numbers as RFC 8785 does (all IR numbers are integers or decimal literals copied from refinements);
- durations as integer milliseconds, sizes as integer bytes, dates as `YYYY-MM-DD` strings, instants never generated;
- text read through `$file` with line endings normalised to LF and a byte order mark removed; no other Unicode normalisation;
- no absolute path, file name, time, host, user, locale-dependent value or source position.

The same contract gives the same bytes on linux, macOS and Windows, under any `TZ`, `LANG` and checkout line ending (FR-9, SCN-015, SM-3). A bundle's integrity hash is computed over these bytes (ADR 0011).

### 11. The source-location side table

Source locations live in a separate document, written next to the IR when asked (`compile --source-map`) and never inside it:

```ts
interface SourceMap {
  irRevision: number;
  locations: Record<string, { file: string; line: number; column: number; endLine: number; endColumn: number }>;
}
```

Keys are `"<layer>#<pointer>"`, the serialised form of an `Origin`. `file` is relative to the workspace root, with forward slashes. Every pass, lint and the CLI turn an origin into `file:line:col` through this table, so diagnostics stay located after the IR is built (FR-1). A pack origin maps to the pack's own file inside its package or bundle.

## Consequences

- Phase 1 writes this shape as the IR JSON Schema and its TypeScript types, then generates the Kotlin and PHP models from the schema (FR-40). Field names here are the ones phase 1 uses; additions follow ADR 0005.
- Targets never walk schemas for rights, never re-derive errors or headers, and find every wire-format detail in `formats`: the IR is larger, target code is smaller and the same in every language.
- Origins as logical pointers keep the IR byte-stable when files move; the cost is one extra lookup through the side table to print a location.
- The `kinds` list, code-identified errors with `http.status`, explicit media types and kind-tagged references are paid now so a later transport is additive (ADR 0014).
- Alphabetical properties may surprise an author who ordered fields deliberately; it is the price of byte identity across files.

## Traceability

- FRs: FR-9, FR-37 (extension slots, open `kind` members), FR-38 (names as segments and role), FR-40 (subset-shaped JSON Schema for model generation), FR-2 (origins of inherited settings), FR-5 (requirements union and order), FR-6 (`derivedFrom`, errors by code), FR-8 (`relays`, documents), FR-23 (field rights), FR-30 (query wire form), FR-31 and A31 (paging styles), FR-33, FR-42 and A30 (formats), FR-27, FR-28.
- CHK items enabled: CHK-024, CHK-025, CHK-033, CHK-045, CHK-052, CHK-059, CHK-077, CHK-078, CHK-092, and the IR side of every server item (CHK-011 to CHK-043).

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
  conventions: Conventions;                 // resolved values, each with its origin; informative only (section 13)
  formats: Record<FormatId, WireFormat>;    // only the formats this api uses, the default included
  pagings: Record<PagingId, PagingStyle>;   // only the paging styles this api uses
  schemas: Record<SchemaId, Schema>;        // named and hoisted inline schemas
  scalars: Record<ScalarId, Scalar>;
  enums: Record<EnumId, Enum>;
  errors: Record<ErrorCode, ErrorDecl>;
  natures: Record<NatureId, NatureDecl>;    // the contract's own natures (ADR 0002 section 11)
  schemes: Record<SchemeId, Scheme>;
  headers: Record<HeaderId, HeaderDecl>;    // identity headers (ADR 0002 section 9)
  identities: Record<IdentityId, Identity>;
  rights: Record<RightId, Right>;
  rules: Record<RuleId, Rule>;
  scopes: Record<ScopeId, Scope>;
  buckets: Record<BucketId, Bucket>;
  services: Record<ServiceId, Service>;
  extensionKeys: Record<ExtensionKeyId, ExtensionKeyDecl>;   // '<prefix>-<key>' to its schema and allowed places
  lint: { rules: Record<string, 'disabled' | 'warning' | 'error'>;   // resolved severities, each with its origin
          allows: { rule: string; at: Origin; reason: Reason; subtree: boolean }[] };   // ADR 0002 section 12
  operations: Operation[];                  // the 'httpOperation' kind, sorted by id
}
```

- `kinds` lists every declaration kind the document uses. A target declares the kinds it supports and refuses an IR with another kind by name, instead of ignoring an unknown collection (ADR 0014, FR-14). A later transport adds a kind and a sibling collection (for example `channels`); it never adds a value to the HTTP method enum.
- Every declaration that an operation uses is at the top level and referenced by id, never nested in an operation, so a later transport reuses the same declarations (ADR 0014).
- Only declarations reachable from an operation, an identity or a convention are kept. Lint reports unused declarations from the source (FR-12), not from the IR.

```ts
interface Api {
  id: string;  name: Name;                  // 'tasks'
  version: number | string;                 // the path version when an integer; a string only with every surface's pathVersion 'none'
  kind: 'product' | 'service';
  pathVersion: { value: 'prefix' | 'none'; origin };   // conventions.pathVersion; a surface may override it
  role?: 'gateway';
  maturity: Maturity;                       // 'experimental' | 'provisional' | 'stable'
  caller?: { identity: IdentityId; right: RightId };
  compat: { policy: 'additive-only' | 'none' };
  surfaces: Record<SurfaceId, { name: Name; prefix: string; pathVersion: 'prefix' | 'none'; origin: Origin }>;
  documents: Record<DocumentId, { surfaces: SurfaceId[]; internal: 'include' | 'exclude' }>;
  docs: Docs;  extensions: Extensions;  origin: Origin;
}
```

### 3. Common members

Every IR object of the kinds below has the members it needs from this list, with these meanings:

| Member | Meaning |
|---|---|
| `id` | the stable key: the catalogue name as written, or for a derived element the canonical identifier of its name (section 9, ADR 0007) |
| `name` | `{ segments: string[], role: string, status?: number }`, the canonical name (ADR 0007 and its amendment); never a final identifier. `status`, from 200 to 399, is present if and only if `role` is `response` (section 13) |
| `origin` | where it was declared (section 6) |
| `derivedFrom` | present on, and only on, an element the compiler derived (section 6) |
| `docs` | `{ summary?, description? }`, resolved text |
| `extensions` | the extension slot: `{ "<prefix>": { "<key>": value } }`, on every object a consumer may extend (api, operation, schema, property, right, rule, scope) and kept empty elsewhere for later use |

### 4. Declarations

```ts
interface ErrorDecl {
  code: ErrorCode;  family?: string;        // the declared family, or the code up to its first dot
  nature: 'refused' | 'unavailable' | 'failed';   // the base nature: every client's retry rule reads this
  natureName?: NatureId;                    // a nature of the 'natures' catalogue, written by '$nature'
  http: { status: number };                 // the status is an HTTP attribute of the error (ADR 0014)
  params?: SchemaRef;  example?: unknown;  title?: string;  docs;
  origin;                                   // the catalogue entry or the tree node that declared it (A35)
  default?: ErrorRole;                      // set when the code is a role's core default (ADR 0006 section 6)
}
interface NatureDecl { id: NatureId; base: 'refused' | 'unavailable' | 'failed'; docs; origin }
interface HeaderDecl {
  id; semantic: 'deadline' | 'traceContext' | 'actorSurface' | 'versionToken';
  name?: string; in?: 'request' | 'response';   // every semantic but versionToken
  response?: string; request?: string;          // versionToken
  schema?: TypeUse; origin;
}

interface Scheme {
  id; kind: 'cookie' | 'header' | 'query' | 'bearer' | 'basic' | 'signature';
  name?: string; csrf?: SchemeId;           // name: the cookie, header or query parameter, or the signature header
  bearer?: { format?: string; oauth2?: { flows: unknown } ; openIdConnectUrl?: string };   // document-only facts
  signature?: { verify: 'template'; format; algorithm; payload; encoding: 'hex' | 'base64'; toleranceMs?: number;
                key: { value: string } | { from: ValueSource } }
            | { verify: 'application'; headers: string[]; key?: { value: string } | { from: ValueSource } };
  origin;
}
interface Identity {
  id; kind: 'credential' | 'signed';
  schemes: { read: SchemeId[]; write: SchemeId[]; optionalRead: SchemeId[] } | { signed: SchemeId };
  principal: SchemaRef | { variants: Record<VariantId, SchemaRef> };
  unknownKeys?: { ignore: Reason } | { keep: Reason };   // signed identities only
  errors: ErrorCode[];
  headers: { header: HeaderId; for: 'all' | 'reads' | 'writes'; required: boolean; schema?: TypeUse;
             from?: ValueSource; stale?: ErrorCode; origin }[];   // uses of the headers catalogue
  docs; extensions; origin;
}
interface Right {
  id; params?: SchemaRef;
  subject: { kind: 'none' } | { kind: 'scope'; scope: ScopeId } | { kind: 'resource'; type: Name; idSchema: SchemaRef };
  guest?: Reason;  errors: ErrorCode[];  docs; extensions; origin; derivedFrom?;   // derivedFrom when a pack declared it
  codeName?: Name;                          // identifier override; the right's name stays its id (ADR 0007)
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
  codeNames?: Record<string, Name>;         // identifier override per value (ADR 0007)
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
  | { kind: 'union'; tag: { in: 'body'; property: string } | { in: 'header'; name: string };   // header: a route's whole input only
      variants: { tag: string; schema: SchemaId }[] }
  ;                                          // each with id, name, typeName?, directions, examples, docs, extensions, origin
interface Property {
  name: string; type: TypeUse; optional: boolean; nullable: boolean;
  sensitive: boolean; restrictedTo?: FieldRestriction; default?: unknown; deprecated: boolean;
  codeName?: Name;                           // identifier override; the wire name stays 'name'
  docs; extensions; origin;
}
type TypeUse =                               // what a property, item, body or parameter is
  | { kind: 'ref'; schema: SchemaId;         // objects, maps and unions are always named
      unknownKeys?: { policy: 'refuse' | 'ignore' | 'keep'; reason?: Reason;   // input uses only (ADR 0003 section 4)
                      origin?: Origin; derivedFrom?: DerivedFrom } }          // origin: the use or 'conventions.input'
  | { kind: 'opaque'; reason: Reason; origin: Origin }   // any JSON value, unchecked (ADR 0003 section 2)
  | { kind: 'file'; media: string[]; maxSizeBytes?: number }   // a multipart field or a download (A39)
  | { kind: 'enum'; enum: EnumId; narrowedTo?: { values: string[]; reason?: Reason } }
  | { kind: 'scalar'; type: 'string' | 'integer' | 'number' | 'boolean'; format?: string; refinements: Refinements;
      content?: { media: 'application/json'; schema: TypeUse } }   // a form or multipart text field holding JSON
  | { kind: 'array'; items: TypeUse; minItems?: number; maxItems?: number };
```

- Objects, maps and unions are always named schemas, hoisted to `schemas` with the deterministic name of ADR 0007; scalars, enum uses and arrays stay inline in their use. Generated code therefore never holds an anonymous structural type (FR-3).
- `allOf`, `pick` and `omit` are already merged (ADR 0003 section 2). A union holds where its tag is read (a body property, or a request header for a union that is a route's whole input) and each variant's tag; the variant schema does not hold the tag property, which targets add inside a body-tagged union only (ADR 0003 section 3).
- `unknownKeys` sits on the use of a schema, never on the schema: an `unknownKeys` written on an inline object moves to the use of its hoisted schema, one inherited from a signed identity sits on the operation's input with `derivedFrom`, and one from `conventions.input.unknownKeys` carries that convention's origin. It covers every object reached from that use. An input use with no `unknownKeys` refuses unknown keys.
- A pattern refinement holds the normalised form of ADR 0003 section 9, never the written text alone.
- `directions` lists `input` and `output` as the schema is used; targets generate per-direction validators from it (ADR 0003 section 4).
- `nullable` and `optional` are two members (FR-3, SCN-005).

### 6. Origins and `derivedFrom`

```ts
interface Origin { api?: string; layer: 'api' | 'shared' | 'base' | 'workspace' | `pack:${string}`; pointer: string }   // api: set on a copy from another api
interface DerivedFrom { derivation: DerivationId; from: Origin[] }
```

- `pointer` is a JSON Pointer into the merged authoring tree of its layer: `/surfaces/app/routes/channels/member/routes/tasks/member/routes/assign`, `/rights/tasks.update`, `/conventions/idempotency/header`. It names a logical position, never a file, so moving content between files leaves it unchanged (ADR 0002 byte-identity rule).
- Every declared element has an `origin`. Every inherited setting on an operation carries the origin of the node that set it (FR-2, SCN-003).
- `layer` is closed, the one exception to the open enums of ADR 0005 section 3: the compiler derives a layer kind from it, and an unknown layer has no meaning for any reader. `workspace` locates a diagnostic on `workspace.yaml` only; no IR element carries it. `pack:<name>` takes no `#`, so the side-table key `<layer>#<pointer>` (section 11) stays unambiguous.
- An element a relay route copies from another api (ADR 0002 section 7) keeps its origin in that api, with `api` naming it; the location is found through that api's side table, or the pinned bundle's sources.
- Every derived element carries `derivedFrom`: the derivation id from the derivation table (ADR 0006) and the origins of the declarations that caused it, for example `{ derivation: 'csrf.cookieWrite', from: [/identities/user, /schemes/sessionCookie] }`. A test walks the IR and fails on a derived element without it (SCN-011, CHK-045).

### 7. The operation

```ts
interface Operation {
  kind: 'httpOperation';
  id: string;  name: Name;                   // 'assignTask'
  surface: SurfaceId;
  op?: 'list' | 'get' | 'create' | 'update' | 'delete' | 'batch';   // the ops shorthand it came from
  resource?: { type: string; idParam?: string; idProperty?: string };   // the collection or single it belongs to: '$collection' value, member id parameter, item id property
  features: Feature[];                       // must-understand features this operation uses (ADR 0005)
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;                              // '/v1/channels/{channelId}/tasks/{taskId}/assign'
  safe: boolean;                             // a GET, or a batch read sent as POST
  params: { path: Param[]; query: Param[]; header: Param[] };       // declared and derived, each with origin or derivedFrom
  unknownQuery: { policy: 'refuse' } | { policy: 'ignore'; reason: Reason; origin: Origin };   // undeclared query keys
  access: Access;
  callerKinds: ('anonymous' | 'identified')[];
  principalRequires: { field: string; origin: Origin }[];
  scopes: { scope: ScopeId; source: ValueSource | { resolver: true }; origin: Origin }[];   // resolution order
  requires: Requirement[];                   // pack-derived (pack, then entry order), then ancestors', then the route's own (ADR 0002 section 8)
  bindings: { from: ValueSource; to: ValueSource; origin: Origin }[];
  input?: { media: string;                   // 'application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'
            schema: TypeUse; bodyLimitBytes: number; rawBody: boolean;
            fields?: { name: string; wire: QueryWire | { kind: 'file' } | { kind: 'json' } }[];   // form and multipart: per top-level field
            origin };
  responses: Response[];                     // success and derived non-error responses (304), sorted by status
  errors: { code: ErrorCode; example?: unknown; derivedFrom?: DerivedFrom; origin?: Origin }[];   // origin: the node that attached it (A35)
  fieldRights: FieldRight[];                 // empty on a relay route: the public operation projects (ADR 0002 section 7)
  idempotency?: { header: string; replayHeader: string; lifetimeMs: number; required: boolean;
                  enforce: 'boundary' | 'none'; derivedFrom } | { exempt: Reason; origin };
  concurrency?: { version: ValueSource; field: string; derivedFrom };   // per operation: a DELETE reads a body source from the query
  owner?: { kind: 'caller'; origin };
  cache?: Cache;
  paging?: Paging;
  filteredBy?: RightId;
  degradable?: { paths: string[]; origin };
  budgetMs?: number;  deadlineHeader?: string;
  deprecated?: { sunset: string; successor?: OperationRef; origin };
  relays?: OperationRef;                     // a relay route: its shape fields carry derivedFrom 'relay.route'
  upstream: ServiceId[];                     // owner first
  maturity: { level: Maturity; source: 'api' | 'upstream' | 'stated'; reason?: Reason; origin };
  internal: boolean;
  csrf?: { header: string; derivedFrom } | { exempt: Reason; origin };
  format: FormatId;
  tags: string[];
  examples: Record<string, { status?: number; request?: true; error?: ErrorCode; value: unknown }>;   // error: value holds the code's params
  docs; extensions; origin;
}

type Access =
  | { kind: 'identity'; identity: IdentityId; schemes: SchemeId[]; origin }
  | { kind: 'optional'; identity: IdentityId; schemes: SchemeId[]; reason: Reason;
      onRefused: 'anonymous' | 'reject'; origin }   // a refused credential: anonymous, or 401
  | { kind: 'public'; reason: Reason; origin };

type Requirement =
  | { kind: 'right'; right: RightId; params?: unknown;
      subject?: { source: ValueSource; defaulted: boolean };
      entry?: string; origin?: Origin; derivedFrom?: DerivedFrom }   // entry: the 'requirements' entry it was written through
  | { kind: 'rule'; rule: RuleId; params?: unknown; bucket?: BucketId;
      entry?: string; origin?: Origin; derivedFrom?: DerivedFrom };

interface Response {
  status: number;
  media?: string;                            // absent for an empty body (204, 304, a redirect); a download's media list is in its file type
  body?: TypeUse;                            // the unwrapped payload, or a file for a download
  shape: 'item' | 'table' | 'list' | 'page' | 'empty' | 'binary' | 'redirect';   // the format's shape; 'binary' and 'redirect' bypass the format
  headers: { name: string; type: TypeUse; required: boolean; semantic?: string; origin?: Origin; derivedFrom?: DerivedFrom }[];
  origin?: Origin; derivedFrom?: DerivedFrom;
}

interface FieldRight {                       // FR-23: materialised so targets never walk schemas
  schema: SchemaId; pointer: string;         // '/effort', '/items/*/effort'
  right: RightId; params?: unknown;
  subject?: { source: ValueSource | { holderField: string } };   // derived from the right's declaration; absent for a right without subject
  direction: 'input' | 'output'; inputPolicy?: 'reject' | 'strip'; derivedFrom: DerivedFrom;
}

interface OperationRef { kind: 'httpOperation'; api: string; id: string }
type ValueSource = { in: 'path' | 'query' | 'header' | 'body' | 'principal' | 'scope'; name: string }
                 | { in: 'host' | 'subdomain' | 'address' } | { in: 'address'; prefixBits: number };
```

- The operation holds everything a target renders: identity and schemes, CSRF, the ordered requirements, scopes, field rights, headers, errors, idempotency, cache, paging. Targets render and never re-derive.
- `requires` is a union tagged by `kind`, keeping the declared order (FR-5, SCN-009). Each item's `params` are values already validated against the right's or rule's params schema.
- `errors` lists every code the operation can answer, declared or derived, each code once (SCN-011). The status of each is read from the registry; a target builds its status union from `responses` and the statuses of `errors`. The undeclared-status 500 is listed like any other code.
- Operation references carry the declaration kind (ADR 0014), so hook requests and `relays` stay valid when other kinds exist.
- Query parameters carry their wire form: `{ name, type, required, wire: { kind: 'number' | 'boolean' | 'list' | 'text' | 'object'; style: 'form' | 'deepObject'; explode: boolean; brackets: boolean }, default?, origin }` (FR-30). That `wire` value is the `QueryWire` that form and multipart fields reuse; `brackets` marks a list sent as `name[]` (ADR 0002 section 7), which the document writes as a parameter named `name[]`.

```ts
interface Cache {
  family: string;
  directives: { maxAgeMs: number; sharedMaxAgeMs?: number; staleWhileRevalidateMs?: number; staleIfErrorMs?: number;
                immutable: boolean; noCache: boolean; mustRevalidate: boolean } | null;   // null for 'never' (no-store)
  anonymous: 'public' | 'private'; vary: string[]; etag: boolean;
  perCallerKind: { caller: 'anonymous' | 'identified'; cacheControl: string }[];   // what OpenAPI lists
  noStore: boolean;                          // true when 'never' or a response carries a sensitive field
  origin; derivedFrom?;
}
interface Paging {
  style?: PagingId;                          // absent for an unpaged list ('paging: none')
  maxLimit?: number; defaultLimit?: number; overLimit: 'reject' | 'clamp'; token?: 'opaque' | 'instant';
  sortKeys: { key: string; right?: RightId; derivedFrom?: DerivedFrom; origin?: Origin }[];
  origin;
}
```

### 8. Wire formats and paging styles

A wire format ([A30](../decisions.md#a30), ADR 0008) is data in `formats`, and a paging style ([A31](../decisions.md#a31)) is data in `pagings`, both with the template language of ADR 0002 sections 13 and 14. The core default `bare` appears in `formats` too, like a pack format, so targets handle one model:

```ts
interface WireFormat {
  id: FormatId; origin;
  media: string;                             // 'application/json', 'application/ld+json'
  absent: 'omit' | 'null';
  success: { item: Shape; table: Shape; list: Shape; page: Shape };   // defaults filled: body '$payload' ('$items' for page), no headers
  meta: Record<string, { type: TypeUse; fill: 'now' | 'traceId' | 'degraded' | 'handler' | ValueSource }>;
  error: { media: string; body: Template; headers: HeaderTemplate[] };   // 'application/problem+json' for 'bare'
}
interface Shape { body: Template; headers: HeaderTemplate[] }
interface HeaderTemplate { name: string; value: Template }

interface PagingStyle {
  id: PagingId; origin;
  position: 'cursor' | 'page' | 'offset' | 'since';
  absent: 'omit' | 'null';
  request: { role: 'cursor' | 'after' | 'before' | 'page' | 'offset' | 'since' | 'limit' | 'sort';
             in: 'query' | 'header'; name: string; base?: 0 | 1; style?: 'signed' | 'pair' | 'keyed' | 'split';
             direction?: string }[];                // split: the direction parameter's name
  response: { body?: Template;               // the whole page body; absent when the style adds 'meta' to the format's page
              meta: { name: string; value: Template }[];   // members joining the format's page $meta
              headers: HeaderTemplate[]; links: { rel: string; role: UrlRole }[] };
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

An `object` template either wraps (the payload under a member, `{ data: $payload, meta: $meta }`) or merges (`merge: 'payload'`, the payload's own members beside the format's members, as JSON-LD puts `@context`, `@id` and `@type` beside an item's fields). An `each` template maps every element of an array slot, as Hydra's `member`, JSON:API's resource objects and HAL's `_embedded` need. Each response records its media type and its `shape`, so a target finds the template without guessing: `item`, `table` and `list` read the format; `page` reads the operation's paging style's `body` when it has one, and otherwise the format's `page` shape with the style's `meta` members in its `$meta`. The IR stores the unwrapped payload and the format and style references only; nothing restates the envelope (FR-42). `handlerResult` lists what the handler returns beside the items, so a target types the handler's page result without reading templates. The slot catalogue, the roles and who fills each one are ADR 0002 sections 13 and 14; the members of the `bare` error body (RFC 9457) are ADR 0006 section 7.

### 9. Canonical ids and ordering

- Ids are the catalogue names as written (schemas, enums, rights, codes...). A derived name (an inline schema, a derived operation id) has the id given by ADR 0007's canonical identifier of its segments. A derived id equal to a declared one is a compile error naming both.
- Records (`Record<...>`) are JSON objects; their order is the serialisation order of section 10.
- Arrays keep the written order where order is meaningful, and are sorted otherwise:

| Kept in written or semantic order | Sorted |
|---|---|
| `requires`; `scopes` (resolution order); `upstream` (owner first); enum `values`; `bucket.key`; `properties` and declared `params` (written order, [A33](../decisions.md#a33); derived params after them); template members; a paging style's `request`; `examples` values of a schema; `packs` (application order) | `operations` (by id); a union's variants (by tag); `errors` (by status, then code); `responses` (by status); `tags`, `vary`, `callerKinds`, `directions`, `kinds`, `features`; `schemes.read`, `schemes.write` and `schemes.optionalRead` of an identity; `fieldRights` (by schema, then pointer, then direction); `sortKeys` (by key); `bindings` (by source) |

Object properties keep the order the author wrote them in (A33), so generated types and Java record constructors list fields as written. ADR 0002 makes that order independent of files: an `$include` merges its keys at its own position, `allOf` members merge in their written order, a `pick` keeps the order of its `fields` and an `omit` the source's order. Properties the compiler adds (a concurrency version field, a rule proof) follow the authored ones, in that order.

### 10. Byte-stable serialisation

The IR file is the IR value serialised as:

- UTF-8, no byte order mark, LF line endings, a final newline;
- object members sorted by the UTF-16 code units of their names (the order of RFC 8785), two-space indentation;
- strings escaped as RFC 8785 does; numbers as RFC 8785 does (all IR numbers are integers; numeric refinements are decimal literal strings, section 13);
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

### 12. The OpenAPI mapping

The OpenAPI 3.1 document is emitted from the IR only (FR-11), and it is the interop surface every other tool reads, so what each IR member becomes in it is fixed here rather than left to the emitter. What OpenAPI states natively is written natively. What it cannot state is written as an `x-seampact-<name>` extension, kebab case, whose JSON Schema `@seampact/openapi` publishes (ADR 0009); the numeric refinements of ADR 0003 section 8 keep the JSON Schema keyword's spelling (`x-seampact-exclusiveMinimum`). A value source is written as in the grammar (`path.taskId`), an origin as its side-table key (`api#/surfaces/app/routes/...`, section 11), a derivation by its id (ADR 0006 section 5). Consumer extension keys are written as `x-<prefix>-<key>` where they are declared (ADR 0002 section 12). The table is closed: an IR member without a row reaches no document, and a new row is a change to this ADR.

The table is what the emitter can write; the app config chooses, per document, what it does write (ADR 0011, [A40](../decisions.md#a40)): `extensions` (`all`, the default, `none`, or a list of extension names) keeps every `x-seampact-*` extension, none, or those listed, the native rows staying; `reasons: omit` drops every reason from the extensions it keeps, so a public document does not publish internal rationale; `inputSchemas: strict` writes, for each schema used as input, a second component named `<name>.input` with `additionalProperties: false` on every object that refuses unknown keys, and points request bodies at it, so a plain OpenAPI reader (a mock server, a request validator, a client generator) sees the input as strict as the boundary serves it; `servers` writes OpenAPI's `servers`. These options select and shape rows; they never add an IR member, and with the defaults the document is the one this section describes.

Which documents exist is the user's choice, for every target alike ([A43](../decisions.md#a43)): per app, seampact's documents, the framework's own document completed by the `nativeDocs` artefact, both, or none (ADR 0011); by default an app with a server target writes seampact's documents, and an app with client targets only writes none. seampact's documents are always written from this table. A monorepo's root config may also ask for a merged document across the apps it lists: the documents of several apis, each mapped by this table, written as one. Each api appears once, taken from the apps that serve it (through their server targets) or document it (OpenAPI-only apps, with an `openapi` key and no target); only an app with client targets and no server target never feeds a merged document (ADR 0011). An element that two apis emit identically (a schema of the workspace's shared file, a shared security scheme, an error code with the same declaration) is written once. Two different elements under one name (an operation id, a component key of `components.schemas` or `components.securitySchemes`, a tag) are refused by `generate` and `check`, naming both apis, both elements and the fix: set a `prefix` for one of the apis in the merged document's entry, which writes `<prefix>.` before every operation id and component key of that api (`billing.listInvoices`, `billing.Invoice`, `billing.api.forbidden`). Two operations with the same method and path are always refused, since one document cannot say which service answers; the fix is a distinct contract path or separate documents. The options above apply to a merged document as to any other.

| IR | OpenAPI |
|---|---|
| `schemes` | `components.securitySchemes`: a cookie scheme is `apiKey` with `in: cookie`, a header scheme `apiKey` with `in: header`, a query scheme `apiKey` with `in: query`, a basic scheme `http` with `scheme: basic`, a bearer scheme `http` with `scheme: bearer` and its `bearerFormat`, or `oauth2` with its `flows`, or `openIdConnect` with its `openIdConnectUrl`; a signature scheme is `apiKey` with `in: header` and its `name`, plus `x-seampact-signature: { verify, format, algorithm, payload, encoding, toleranceMs, key }` for a template, or `{ verify: application, headers, key }` |
| `access`, identity | `security`: one Security Requirement Object per scheme the operation accepts (`schemes.read` on a safe operation, `schemes.write` otherwise). A cookie scheme with `csrf`, on a write, is one object holding the cookie scheme and its CSRF header scheme, since an object's schemes are all required. Plus `x-seampact-access: { identity }`. Credential and CSRF headers are written through the schemes, never as parameters |
| `access`, optional | the same list with `schemes.optionalRead` added on a read, plus `{}` (anonymous allowed), and `x-seampact-access: { identity, optionalAuth: <reason>, onRefused }` |
| `access`, public | `security: []` and `x-seampact-access: { public: <reason> }` |
| `access` of a signed identity | `security` with the signature scheme alone, `x-seampact-access: { identity }`, and `x-seampact-raw-body: true` on the request body |
| `csrf` exemption | `x-seampact-csrf: { exempt: <reason> }` |
| `principalRequires`, `bindings` | `x-seampact-principal-requires: [<field>]`, `x-seampact-bindings: [{ from, to }]` |
| `scopes` | `x-seampact-scopes: [{ scope, from }]` in resolution order; `from` is the source, or `resolver` |
| `requires` | `x-seampact-requires`: the items in order, `{ right, params, subject }` or `{ rule, params, bucket }`, with `entry` when written through a `requirements` entry |
| `fieldRights` | `x-seampact-restricted-to: [{ schema, pointer, right, params, direction, input }]` on the operation, empty and left out on a relay route |
| `filteredBy` | `x-seampact-filtered-by: <right>` |
| `paging` | the request roles as ordinary parameters (`maximum` from `maxLimit` unless `overLimit` is `clamp`, `default` from `defaultLimit`), the page as the response body schema the format and style give, the style's headers and `Link` as response headers, plus `x-seampact-paging: { style, position, roles: { <role>: <source> }, maxLimit, defaultLimit, overLimit, token, sortKeys: [{ key, right }] }`, or `{ none: true }` for an unpaged list |
| `concurrency` | the version as an ordinary parameter or body property, `ETag` on the responses carrying the item, plus `x-seampact-concurrency: { version, field }` |
| `idempotency` | the key header parameter and the replay response header, plus `x-seampact-idempotency: { header, replayHeader, lifetimeMs, required, enforce }`, or `{ exempt: <reason> }` |
| `owner` | `x-seampact-owner: caller` |
| `input` | the request body with its media type: the format's for JSON; `application/x-www-form-urlencoded` with an `encoding` entry per list or object field (`style: form`, `explode` as the conventions say); `multipart/form-data` with each file field as `type: string` with `contentMediaType` (the media list in the part's `encoding.contentType`) and `x-seampact-max-size`, and each JSON text field with `contentMediaType: application/json` and `contentSchema`. Component schemas carry no `additionalProperties: false`, since one schema serves both directions: strict input is the default every reader of a seampact document assumes, and an ignoring or keeping use writes `x-seampact-unknown-keys: { ignore: <reason> }` or `{ keep: <reason> }` on the request body |
| `unknownQuery` | `x-seampact-unknown-query: { ignore: <reason> }` on an operation that ignores undeclared query keys |
| `responses` | the success responses, each body the format's shape written out around a reference to the payload schema, with the format's media type; a download as one content entry per media type, each `{ schema: { type: string, contentMediaType } }`, with `Content-Disposition`; a redirect as its status with the `Location` header and no content |
| `errors` | one response per error status, its `description` the list of its codes, its body the format's error body; each code is a component schema of that body for the code's params, named by the code (`api.forbidden`), with `x-seampact-nature`. Since a code now takes the component key alphabet (ADR 0002 section 4), a code equal to a schema id, a hoisted inline schema name or `<schema>.input` would share a key with that schema in `components.schemas`; the compiler refuses it (ADR 0006 section 3), so every document option emits distinct keys. Several codes on one status are a `oneOf`, with a `discriminator` on the member the format writes `$code` to when it is a top-level member (`code` under `bare`). The response carries `x-seampact-errors: [{ code, derivedFrom, origin }]`: each code's derivation, or the node that attached it |
| `examples` | the route examples, wrapped through the format and the paging style (ADR 0002 section 12), in the `examples` of the request body or of the response for their status or code |
| `cache` | the `Cache-Control` response header (its directives from the family) with `x-seampact-cache-control: { anonymous, identified }`, one value per caller kind, plus `ETag`, `If-None-Match` and the 304 when `etag` is set |
| identity headers | ordinary header parameters and response headers, each with `x-seampact-semantic` (`deadline`, `traceContext`, `actorSurface`, `versionToken`) |
| `budgetMs`, `upstream`, `maturity`, `degradable` | `x-seampact-budget-ms`, `x-seampact-upstream`, `x-seampact-maturity: { level, source, reason }`, `x-seampact-degradable` |
| `deprecated` | `deprecated: true`, the deprecation headers on the responses, and `x-seampact-deprecation: { sunset, successor }` |
| `internal` | left out of a document with `internal: exclude`; `x-seampact-internal: true` in the others |
| `relays` | `x-seampact-relays: { api, operationId }` |
| `format` | the media types above, `x-seampact-format: <format>` at the document root, and on an operation whose format differs |
| `api.kind`, `api.role`, `api.caller` | `x-seampact-api: { kind, role, caller }` at the document root; in a merged document (below), `x-seampact-apis: [{ name, kind, role, caller }]` at the root instead, and `x-seampact-source-api: <name>` on each operation |
| schema marks | ADR 0003: `format: password` for `sensitive`, `{}` with `x-seampact-opaque: <reason>` for an opaque value, `x-seampact-discriminator` for a header-tagged union, `x-seampact-enum` and `x-seampact-enum-fallback` for an open output enum, the `x-seampact-*` refinements of `int64` and `decimal` |

```yaml
# emitted from the reference contract of ADR 0002 (excerpt)
paths:
  /v1/health:
    get:
      operationId: health
      security: []
      x-seampact-access: { public: "Probes call it before any user exists." }
  /v1/channels/{channelId}/tasks/{taskId}:
    patch:
      operationId: updateTask
      security:
        - { sessionCookie: [], csrfToken: [] }
        - { bearer: [] }
      x-seampact-access: { identity: user }
      x-seampact-scopes: [{ scope: channel, from: path.channelId }]
      x-seampact-requires: [{ right: tasks.update, subject: path.taskId }]
      x-seampact-concurrency: { version: body.expectedVersion, field: version }
      x-seampact-idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetimeMs: 86400000, required: true, enforce: boundary }
      responses:
        '403':
          description: 'api.csrf_invalid, api.forbidden'
          content:
            application/problem+json:
              schema:
                oneOf: [{ $ref: '#/components/schemas/api.csrf_invalid' }, { $ref: '#/components/schemas/api.forbidden' }]
                discriminator: { propertyName: code }
          x-seampact-errors:
            - { code: api.csrf_invalid, derivedFrom: csrf.cookieWrite }
            - { code: api.forbidden, derivedFrom: requirement.errors }
components:
  securitySchemes:
    stripeSignature:
      type: apiKey
      in: header
      name: Stripe-Signature
      x-seampact-signature: { verify: template, format: 't={ts},v1={sig}', algorithm: hmac-sha256, payload: '{ts}.{rawBody}', encoding: hex, toleranceMs: 300000, key: { value: stripe } }
```

A moved or added code therefore shows in the committed document's diff (ADR 0011 `checks.openapi`) on every operation it reaches, which is how a reviewer sees an attachment that an indentation slip moved up the tree (ADR 0002 section 8).

### 13. Schema forms (amendment 2026-10-12, M1)

From M1, the merge of the IR JSON Schema (p1-ir-schema), the schema files in `packages/spec/schemas/ir` are normative for member shapes: names, types, optionality and union tags. The TypeScript sketches of sections 2 to 8 and 11 are informative; where they differ, the schema holds, and a change to it is an IR change PR (ADR 0005 section 1). `packages/spec/schemas/ir/README.md` gives the reader rules. The forms the schema chose, each with its reason:

- **Tagged unions.** A union is a wrapper with `discriminator` and `oneOf`; each variant fixes its tag with `const`. Generated Kotlin and PHP models get a sealed hierarchy with an `Unknown` variant, and an unknown tag is named instead of failing as a generic schema error.
- **Every choice between shapes is tagged.** `principal` is `{ kind: schema, schema }` or `{ kind: variants, variants }`; a signature `key` is `{ kind: value, value }` or `{ kind: from, from }`; `unknownKeys` of a signed identity is `{ policy: ignore | keep, reason }`; an enum `source` is `{ kind: vocabulary, vocabulary }` or `{ kind: enum, enum }`; a `Scheme` is tagged on its `kind`: cookie `{ name, csrf? }`, header `{ name }`, query `{ name }`, bearer `{ bearer? }`, basic `{}`, signature `{ name?, signature }` (the document-only bearer facts are `BearerFacts`, the verification `SignatureVerify`); an `Identity` is tagged on its `kind`: credential `{ schemes: { read, write, optionalRead } }` or signed `{ signed, unknownKeys? }`, so `unknownKeys` exists on signed identities only; `idempotency` and `csrf` are `{ kind: derived, ... }` or `{ kind: exempt, reason, origin }`; a text template part and an object template member name are `{ kind: text, text }` or `{ kind: slot, ... }`; `Api.version` is `{ kind: path, number }` or `{ kind: label, label }`. An untagged union becomes an all-optional bag in every generated model, which ADR 0003 refuses.
- **Five structs stay.** A definition stays a struct only when one member decides which optional members are present and several of its values share one shape, so a union would repeat that shape once per value; its rule is an invariant that applies to known values only. `ValueSource` is `{ in, name?, prefixBits? }` (by `in`: `name` for the named sources, none for the bare ones, `prefixBits` for `address` only; a scope's `{ resolver: true }` and a field right's `{ holderField }` are the `in` values `resolver` and `holderField`, with `name`); `FieldWire` is `{ kind, style?, explode?, brackets? }` (the five query wire kinds carry all three, `file` and `json` none); a format `meta` member is `{ type, fill, source? }` (`source` only for `fill: source`); `HeaderDecl` is `{ semantic, name?, in?, response?, request? }` (`versionToken` carries `response` and `request`, every other semantic `name` and `in`); `Cache` is `{ family, directives?, anonymous, vary, etag, perCallerKind, noStore, origin, derivedFrom? }` (`directives` for every family but `never`, which sets `noStore`; `family` is an open string, not an enum, and the invariant reads the one reserved name `never`). Each partition of a deciding member's values is tested to equal the schema's known list, so a new known value cannot miss its invariant.
- **Invariants.** What the subset cannot state (no conditional keyword) has a stable id and is checked by `checkIrInvariants` in `@seampact/spec/ir`, owned by the finalize pass (p2-finalize): `Name.status` and its role, `meta.source` and `fill`, `ValueSource` members by `in` and their places, `HeaderDecl` members by semantic, `Cache.directives` and the `never` family, `csrf` on an unsafe cookie-scheme operation, `FieldWire` members, a property's `nullable`, a named format's own type, the kind of an id (`ir.id.scalar`), and every catalogue id naming an existing entry (`ir.ref.resolves`). A new invariant is a tightening IR change (ADR 0005 section 4); relaxing one is breaking.
- **Open enums.** A string with its known values in `x-seampact-known`, never a closed `enum` (ADR 0005 section 3). Every object, union and open enum is a named definition, so every generated type has a name.
- **Must-act definitions.** `x-seampact-must-act` marks the unions and enums of a security boundary: `Access`, `Requirement`, `RightSubject`, `Scheme`, `SignatureVerify` and its `SchemeKey`, `Identity`, `KeysPolicy`, `UnknownQuery`, `Idempotency`, `Csrf`, `RefusedCredential` (`onRefused`), `UnknownKeysPolicy` and `InputPolicy`. An unknown tag (a union) or value (an enum) there makes the IR invalid for every reader, since one that skipped it would generate a weaker check silently; a new tag or value there always comes with a feature name, and adding must-act to an existing definition is a tightening that names one too.
- **TypeScript unknown arm.** Each generated union is `Known<Name> | UnknownVariant<tag>`, the tag typed `string & {}`. TypeScript narrows no union holding that arm, so `isKnownVariant` narrows to the known variants first; a closed union would let an exhaustive `switch` miss an unknown tag at run time. A producer types each union value it writes as `Known<Name>` (`satisfies`), since `<Name>` also accepts the unknown arm; a closed writer view of the IR for the compiler passes is recorded for p2-pipeline, a package addition and not an IR change. Definition and variant names are the generated type names: renaming one, or switching a struct and a union, is breaking.
- **`Origin.layer`** is closed and gains `workspace` (section 6).
- **`Name.status`** is an integer from 200 to 399, as `@seampact/spec/naming` checks. It couples the transport-neutral `Name` to HTTP statuses; that is accepted until a non-HTTP kind derives response names, which then adds its own qualifier as an IR change.
- **`irVersion`** is an integer from 1, not the constant 1, so a reader names a later version (`checkIrSupport`) instead of failing on a generic schema error.
- **Numeric refinements** (`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`) are decimal literal strings (`^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`), one form for every scalar, so an `int64` bound or a `decimal` step keeps every digit in every language; every IR number is an integer (section 10).
- **`nullable`** is a required member of a property and an optional member of every other type use but an opaque one (array items, map values, parameters, headers, bodies), as ADR 0003 section 6 allows it on any schema; an opaque value already admits `null`.
- **Named formats.** The `scalars` catalogue holds `{ id, name, type, directions, docs, origin }`, `type` a scalar type use; a use of a named format holds its type and refinements inline and names it in `scalar`, so a target maps it to a native type or checks it with the portable keywords. `format` holds the portable formats of ADR 0003 section 8 only. `Refinements` is `{ minLength?, maxLength?, pattern?: { source, normalized }, minimum?, ... }`.
- **Ids are type uses.** `Scope.idSchema`, a resource subject's `idSchema` and a rule proof's `schema` are a `TypeUse`, not a `SchemaRef`: ADR 0002 writes an id as a scalar or a named format (`org: { id: OrgId }`), and a `SchemaRef` names an object, map or union schema of the `schemas` catalogue only. Invariant `ir.id.scalar` narrows them: a scope's and a resource subject's id is a `scalar` or `enum` use without `nullable`, and a proof is anything but `opaque` and `file`. `ir.ref.resolves` checks the references inside them (`scalar`, an enum's name, a proof's ref `schema`) like any other.
- **`conventions`** is informative only: a map from the dotted convention path to `{ value, origin }`, for provenance, `explain` and lint. A target never acts on it; every convention a target acts on (the `int64` wire form, the handling of open output enums) becomes a typed member, as an additive IR change (p2-derive-wire adds them). An absent typed convention member means the ADR 0003 default: `int64` travels as a string, and output enums are closed. Until such a member exists, the compiler refuses a non-default value of that convention by name, so no target meets an IR whose behaviour it cannot read.
- **Absent, never null.** The subset has no `null` type, so `Cache.directives` is absent for `never`; `noStore` is authoritative (no response is stored when it is true, whatever the directives hold).
- **Declarations the sketches leave open.** `ExtensionKeyDecl` is `{ id, prefix, key, schema: TypeUse, places, origin }`; `lint.rules` values are `{ severity, origin }`; `FieldRestriction` is `{ right, params?, inputPolicy?, origin? }`; `Param` is `{ name, type, required, wire?, default?, origin?, derivedFrom? }`; `Property.derivedFrom` is optional; `Identity.extensions` is required; a route example's `request` is a boolean; a paging role's `base` is an integer from 0 to 1; a `Slot` is a string.
- **Ids and strings.** Catalogue keys carry the grammars of ADR 0002 section 4, derived ids the escaped identifiers of the ADR 0007 amendment (`_404GoneError`, `List_`); a right and a principal variant take any name (`__proto__` included), so readers always read IR maps with `Object.hasOwn` or through a `Map`. A `Reason` is non-empty, without leading or trailing white space. `SourceLocation.file` is relative, with forward slashes, no `.` or `..` segment and no `:`. An access's `schemes` list is never empty.

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

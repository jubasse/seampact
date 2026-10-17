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
            proofs?: { name: string; schema: TypeUse; wire?: QueryWire | { kind: 'json' }; derivedFrom }[];   // body rule proofs (section 13); wire: form and multipart only
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

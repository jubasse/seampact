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
  errors: { code: ErrorCode; example?: unknown; derivedFrom?: DerivedFrom; origin?: Origin;   // origin: the node that attached it (A35)
            roles?: { role: ErrorRole; params?: Template }[];   // irRevision 4: the roles this code answers here, sorted by role
            retryHeader?: { name: string; param: string; unit: 's' | 'ms'; derivedFrom } }[];   // irRevision 4: a bucket rule's 429
  fieldRights: FieldRight[];                 // empty on a relay route: the public operation projects (ADR 0002 section 7)
  idempotency?: { header: string; replayHeader: string; lifetimeMs: number; required: boolean;
                  enforce: 'boundary' | 'none'; derivedFrom } | { exempt: Reason; origin };
  concurrency?: { version: ValueSource; field: string; derivedFrom };   // per operation: a DELETE reads a body source from the query
  owner?: { kind: 'caller'; origin };
  cache?: Cache;
  paging?: Paging;
  filteredBy?: RightId;
  degradable?: { paths: string[]; header?: string; origin };   // header: irRevision 4
  budgetMs?: number;  deadlineHeader?: string;
  deprecated?: { since: string; sunset: string; successor?: OperationRef; successorRel?: string; origin };   // since, successorRel: irRevision 4
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
  headers: { name: string; type: TypeUse; required: boolean; semantic?: ResponseHeaderSemantic; origin?: Origin; derivedFrom?: DerivedFrom }[];
  docs?: Docs;                               // the docs written on the response (irRevision 3)
  origin?: Origin; derivedFrom?: DerivedFrom;
}

interface FieldRight {                       // FR-23: materialised so targets never walk schemas
  schema: SchemaId; pointer: string;         // '/effort', '/items/*/effort'
  right: RightId; params?: unknown;
  subject?: { source: ValueSource | { holderField: string } };   // derived from the right's declaration; absent for a right without subject
  always?: 'absent';                         // irRevision 4: the field is never sent here, no decide call
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

- A field right with `always: absent` (irRevision 4) is an output right whose field is never sent on this operation: it carries no `subject`, `inputPolicy` or `params`, and the target makes no decide call (ADR 0003 section 6). Without `always`, a field right carries `subject` if and only if its right's subject kind is not `none` (invariant `ir.field-right.always`).
- A sort key's `params` and `subject` (irRevision 4) sit only with its `right`: the right's params, validated against its params schema, and where its subject is read on the request, the route's resolved scope or its default subject, never a holder field; `subject` is present if and only if the right's subject kind is not `none` (invariant `ir.sort-key.right`).
- `degradable.header` (irRevision 4) names the header listing the degraded parts: required when the operation's format has no `degraded` meta member (invariant `ir.degradable.header`); the compiler writes it beside one only when `conventions.degradedHeader` is set, and then the target fills both. Its value is the paths of `degradable.paths` degraded in this response, as written, in `paths` order, an RFC 9110 section 5.6.1 list joined by `, `; the header is left out when no part is degraded.
- A deprecated operation's 2xx responses each carry one header of semantic `deprecation`, one of `sunset`, and one of `successorLink` if and only if `deprecated.successor` is set, which comes with `successorRel`, and no other response carries a header of these semantics: a redirect or a 304 is no success (invariant `ir.deprecation.headers`). A successor in the same api names an operation of the document, and each of its path params is a path param of the deprecated operation with the same type use; a successor in another api is checked at compile time only. The values are computed from the date's fields, never the machine's zone: `deprecation` is `@<unix seconds of since at 00:00:00 UTC>` (RFC 9745); `sunset` is the IMF-fixdate of `sunset` at 00:00:00 GMT (RFC 8594, RFC 9110 section 5.6.7); `successorLink` is `<target>; rel="<successorRel>"` (RFC 8288), the target the successor's path with each path param the deprecated request's param of the same name, its decoded value percent-encoded as one path segment, every octet of its UTF-8 bytes outside RFC 3986 `unreserved` encoded (a `%` too, so an encoded value is encoded again; a `.` or `..` value stays as is, and the link resolves on the same origin), never the raw or decoded text, a relative reference under `api.wire.urls: relative` and absolute from the configured origin under `absolute` (section 13).
- `deprecated.since` (irRevision 4) is the day the operation is deprecated; `since` and `sunset` are calendar dates, real days of the proleptic Gregorian calendar from 0001 to 9999, `since` not after `sunset` (invariant `ir.deprecation.since`).
- An error element's `roles` (irRevision 4) say which roles of ADR 0006 section 6 the code answers on this operation, a role at most once across the operation's elements (invariant `ir.operation.role-once`); `ErrorDecl.default` only marks the core default. A binding's `params` is a compiled `Template` (section 8), present if and only if the code declares params, with no `each` inside another `each`'s `as` (invariant `ir.error.role-params`); a binding without an authored template holds the by-name object template: one member per param of the code that has a datum of the same name for the role, in the params schema's property order, each the slot of that datum. A target renders it with grammar 13 "Templates", the slots being the role's data plus `item` inside `each`, except: a slot without a value has none, and a member without a value is omitted whatever the format's `absent`; a text template with a part without a value has none, and a number or boolean part is its JSON text; an array item without a value is dropped; `each` over an empty array gives `[]`, over a slot without a value none; `merge` of a slot without a value adds no member; an object left with no member has no value, except the top-level params object, kept as `{}`. The rendered params validate against the code's params schema, and the format's `$params` slot holds them; a binding whose `role` is unknown is named and refused where the target acts on it.
- An error element's `retryHeader` (irRevision 4) sits only on a code of status 429 derived from `rule.bucket`; its `param` is a required, non-nullable `integer` member of the code's params with `minimum` at least 0 and `maximum` at most 9007199254740991 (invariant `ir.error.retry-header`). The target writes the header on every response of that code on the operation, a handler's typed error result included, from the rendered params' `param` member: under `ms` its decimal integer, under `s` `ceil(ms / 1000)` as a decimal integer, never an exponent form.

```ts
interface Cache {
  family: string;
  directives: { maxAgeMs: number; sharedMaxAgeMs?: number; staleWhileRevalidateMs?: number; staleIfErrorMs?: number;
                immutable: boolean; noCache: boolean; mustRevalidate: boolean } | null;   // null for 'never' (no-store)
  anonymous: 'public' | 'private'; vary: string[]; etag: boolean;
  perCallerKind: { caller: 'anonymous' | 'identified'; cacheControl: string }[];   // what OpenAPI lists
  noStore: boolean;                          // true when 'never' or a response carries a sensitive value
  origin; derivedFrom?;
}
interface Paging {
  style?: PagingId;                          // absent for an unpaged list ('paging: none')
  maxLimit?: number; defaultLimit?: number; overLimit: 'reject' | 'clamp'; token?: 'opaque' | 'instant';
  sortKeys: { key: string; right?: RightId; params?: unknown; subject?: FieldRightSubject;   // params, subject: irRevision 4
              derivedFrom?: DerivedFrom; origin?: Origin }[];
  origin;
}
```

- `Cache.noStore` is set on an operation whose responses carry a sensitive value (ADR 0003 section 6, invariant `ir.cache.sensitive-no-store`): a property marked sensitive, or a scalar use marked sensitive (section 5), reached from a body through array items, JSON content, object properties, map keys and values and union variants, or from a response header's type. Without a `cache`, the compiler writes `{ family: never, noStore: true }` located at the value, derivation `cache.sensitive`. A value outside a field of the body (a whole scalar body or its items, a map key, a response header) is no-store under `conventions.cache.sensitiveElsewhere: noStore`, the default, and a compile error under `refuse` (ADR 0002 section 13), so the IR never holds one without `noStore`.

# Worked example and scenario self-check

## Worked example: the reference tasks api

A workspace of two apis: a product api with a tenant-scoped collection under rights, a single owned by the caller, a signed webhook surface, and a service api whose route relays a public operation. Schemas are kept short; their language is ADR 0003.

```yaml
# workspace.yaml
workspace:
  apis:
    tasks: ./tasks/api.yaml
    tasksService: ./tasks-service/api.yaml
  shared: ./shared/base.yaml
```

```yaml
# shared/base.yaml: the workspace's shared file, seen by both apis
schemes:
  sessionCookie: { kind: cookie, name: __Host-session, csrf: csrfToken }
  csrfToken: { kind: header, name: X-Csrf-Token }
  bearer: { kind: bearer }
  internalToken: { kind: bearer, bearerFormat: jwt }
  stripeSignature:
    kind: signature
    name: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }

headers:
  deadline: { name: X-Deadline, in: request, semantic: deadline }
  trace: { name: traceparent, in: request, semantic: traceContext }
  actorSurface: { name: X-Actor-Surface, in: request, semantic: actorSurface }

identities:
  user:
    schemes: { read: [sessionCookie, bearer], write: [sessionCookie, bearer] }
    principal: UserPrincipal
  service:
    schemes: { read: [internalToken], write: [internalToken] }
    principal: ServicePrincipal
    headers:
      deadline: { for: all, required: true }
      trace: { for: all }
      actorSurface: { for: writes, required: true, schema: { enum: Surface } }
  stripe:
    kind: signed
    scheme: stripeSignature
    principal: WebhookCaller

scopes:
  channel: { id: ChannelId, errors: [api.not_found] }

rights:
  roles:
    params: { allowed: { type: array, items: { enum: Role }, minItems: 1 } }
    subject: { scope: channel }
  tasks.read:
    subject: { scope: channel }
  tasks.update:
    subject: { resource: Task, id: TaskId }
    errors: [api.forbidden, api.not_found]
  tasks.seeEffort:
    subject: { resource: Task, id: TaskId }
  callerService:
    params: { allowed: { type: array, items: { enum: Service }, minItems: 1 } }

rules:
  throttle:
    bucket: true
    errors: [api.rate_limited]
  recentAuth:
    params: { intent: { enum: ReauthIntent } }
    proof: { in: body, name: reauthToken, schema: ReauthToken }
    errors: [api.reauthentication_required]

buckets:
  write: { key: [principal.userId], limit: 60, window: 1m }

errors:
  api.schema_invalid:
    status: 400
    nature: refused
    params: { issues: Issues }
    example: { issues: [{ pointer: /title, rule: minLength }] }
  api.rate_limited:
    status: 429
    params: { retryAfterMs: { type: integer, minimum: 0 } }
    example: { retryAfterMs: 1500 }
  api.reauthentication_required: { status: 401 }

pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
      sort: { query: sort, style: signed }
    response:
      body: $items
      links: { next: $next }

conventions:
  paging: { default: cursor, maxLimit: 100 }
  idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetime: 24h }
  bodyLimit: 1MiB
  batch: { maxIds: 200, bodyLimit: 2MiB }
  cache: { families: { minute: 60s, hour: 3600s } }
  restrictedInput: reject
  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }
  errors:
    every: [api.internal]
    derived:
      schemaInvalid:
        code: api.schema_invalid
        params: { issues: { $each: $issues, $as: { pointer: $item.pointer, rule: $item.rule } } }

enums:
  Role: { values: [owner, editor, viewer], reason: "Roles are local to this product." }
  TaskState: { values: [open, done, archived], reason: "Task states belong to this api." }
  Surface: { values: [app, studio], reason: "The product's entry points." }
  Service: { values: [catalog, ticketing], reason: "The product's internal services." }
  ReauthIntent: { values: [purge_task], reason: "The actions that ask for a fresh sign-in." }

schemas:
  $include: ./schemas.yaml
```

```yaml
# shared/schemas.yaml
ChannelId: { type: string, format: uuid }
TaskId: { type: string, format: uuid }
UserId: { type: string, format: uuid }
UserPrincipal:
  type: object
  required: [userId]
  properties: { userId: UserId }
ServicePrincipal:
  type: object
  required: [service, userId]
  properties: { service: { enum: Service }, userId: UserId }
WebhookCaller:
  type: object
  required: [account]
  properties: { account: { type: string } }
Issues:
  type: array
  items:
    type: object
    required: [pointer, rule]
    properties: { pointer: { type: string }, rule: { type: string } }
Task:
  type: object
  required: [taskId, title, state, version, createdAt]
  properties:
    taskId: TaskId
    title: { type: string, minLength: 1, maxLength: 200 }
    state: { enum: TaskState }
    effort: { type: integer, minimum: 0, restrictedTo: tasks.seeEffort }
    version: { type: integer, minimum: 1 }
    createdAt: { type: string, format: date-time }
ReauthToken: { type: string, minLength: 1, maxLength: 512 }
```

`tasks/schemas.yaml` (not shown) declares the api's own schemas in the same way: `Health`, `Channel`, `CreateTask` and `UpdateTask` (picked from `Task`, ADR 0003 section 2; `CreateTask` overlays `effort` with `restrictedTo: { right: roles, params: { allowed: [owner] } }`, a scope right, since a create has no member id for `tasks.seeEffort`, section 6 of ADR 0003), `ArchiveTask` (its reason; `concurrency` adds `expectedVersion` to it and to `UpdateTask`), `Preferences`, `UpdatePreferences`, `DraftId`, `Draft`, `PaymentEvent`, `TaskQuery` and `TaskSearchResult`.

```yaml
# tasks/api.yaml
api:
  name: tasks
  version: 1
  kind: product
  maturity: provisional
  summary: Tasks shared inside channels.
  compat: { policy: additive-only }
  documents:
    public: { surfaces: [app], internal: exclude }
    full: {}

schemas:
  $include: ./schemas.yaml

requirements:
  channelEditor: { right: roles, params: { allowed: [owner, editor] } }
  writeThrottle: { rule: throttle, bucket: write }

surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes:
      health:
        method: get
        access: { public: "Probes call it before any user exists." }
        output: Health
      channels:
        kind: collection
        id: { channelId: ChannelId }
        item: Channel
        ops: [list, get]
        member:
          scopes: { channel: path.channelId }
          routes:
            tasks:
              kind: collection
              id: { taskId: TaskId }
              item: Task
              concurrency: { version: body.expectedVersion, field: version }
              ops:
                list:
                  paging: { cursor: { maxLimit: 50 } }
                  sortable: [createdAt]
                  filteredBy: tasks.read
                get: {}
                create:
                  input: CreateTask
                  requires: [writeThrottle, channelEditor]
                update:
                  input: UpdateTask
                  requires: [{ right: tasks.update }]
                batch: { maxIds: 200 }
              collection:
                routes:
                  search: { $include: ./routes/tasks/search.yaml }
              member:
                routes:
                  assign:
                    method: post
                    requires: [channelEditor]
                    input:
                      type: object
                      required: [userId]
                      properties: { userId: UserId }
                    output: Task
                  archive:
                    method: post
                    concurrency: inherit
                    input: ArchiveTask
                    output: Task
                    internal: true
                  purge:
                    method: post
                    requires: [{ rule: recentAuth, params: { intent: purge_task } }]
                    responses:
                      204: {}
      me:
        kind: single
        routes:
          preferences:
            kind: single
            owner: caller
            item: Preferences
            ops:
              get: { cache: { freshness: minute, etag: true } }
              update: { input: UpdatePreferences }
          drafts:
            kind: collection
            id: { draftId: DraftId }
            item: Draft
            owner: caller
            ops:
              get: {}
              delete: { output: Draft }
  hooks:
    prefix: /v{version}/hooks
    identity: stripe
    routes:
      payments:
        method: post
        input: PaymentEvent
        responses:
          204: {}
```

```yaml
# tasks/routes/tasks/search.yaml
method: post
summary: Search the channel's tasks with a structured query.
idempotency: { exempt: "A read with a body; replaying it is harmless." }
requires: [{ right: tasks.read }]
input: TaskQuery
output: TaskSearchResult
budget: 300ms
examples:
  firstPage: { status: 200, value: { $file: ../../examples/search-200.json } }
```

```yaml
# tasks-service/api.yaml
api:
  name: tasksService
  version: 1
  kind: service
  caller: { identity: service, right: callerService }
  maturity: provisional

surfaces:
  internal:
    prefix: /internal/v{version}
    requires: [{ right: callerService, params: { allowed: [catalog] } }]
    routes:
      getTask: { relays: tasks.getTask }
```

What the example shows, by route:

- Errors: the base declares only `api.schema_invalid` (its `Issues` carry no `in`, so the role is bound with a params template) and `api.rate_limited` (an example, and a nature left to its status). Every other derived error answers its role's default code (A34), and `api.internal`, `api.not_found` and `api.forbidden` are default codes attached by name.

- `listTasks` (`GET /v1/channels/{channelId}/tasks`): identity `user` from the surface, scope `channel` from the member path of `channels`, the base's `cursor` style (the item array as the body, the next page in a `Link` header) capped at 50, the sort key `createdAt` (`effort` is not sortable here: its resource right `tasks.seeEffort` has no subject on a list route, ADR 0003 section 6), `filteredBy`. A missing channel answers the scope's `api.not_found` only: the `channel` scope reads `path.channelId`, so `member.notFound` derives no second 404 for it (ADR 0006 section 5).
- `createTask`: the `writeThrottle` and `channelEditor` entries, so `throttle` then `roles` in that order, a body whose `effort` only an `owner` of the channel may send, an idempotency key from the conventions, CSRF from `sessionCookie` on a write.
- `updateTask`: `tasks.update` with the subject defaulting to `path.taskId`, the version read from `body.expectedVersion` and compared to `Task.version`, 409 `state.conflict`.
- `archiveTask`: a member action that opts into the version, kept out of the `public` document.
- `purgeTask`: a member action without `input` under the `recentAuth` rule, whose body proof `reauthToken` becomes the whole input (section 9; ADR 0004 section 13).
- `searchTasks`: an included route, idempotency exempt with its reason, a 300 ms budget, a named example.
- `getPreferences` and `updatePreferences`: a single owned by the caller, conditional GET; `deleteDraft` answers 200 with the deleted record.
- `payments` (`POST /v1/hooks/payments`): the signed `stripe` identity, raw body, no CSRF and no idempotency key, 204.
- `getTask` in `tasksService` (`GET /internal/v1/channels/{channelId}/tasks/{taskId}`): a relay route, its path, item and `notFound` code (`api.not_found`, from `member.notFound`) copied from `tasks.getTask`; `Task.effort` is sent whole, since a relay route has no field rights and `getTask` projects it; the service identity with its deadline and trace headers (its actor-surface header applies to writes only), `callerService` allowing `catalog`. The `channel` scope and its denial stay with the public operation.

Short forms not in the reference contract:

```yaml
# fragments, one per feature
signIn:
  method: post
  access: { public: "Signing in is how a visitor gets a session." }
  requires: [{ rule: throttle, bucket: signInPerEmail }]
  input: SignInInput
  output: Session
signOut:
  method: post
  access: { optionalAuth: "Signing out must succeed, even with an expired session." }
  csrf: { exempt: "A forged sign-out harms no one." }
  responses: { 204: {} }
updateProfile:
  method: patch
  principal: { requires: [profileId] }
  bindings: { body.profileId: principal.profileId }
  input: UpdateProfile
  output: Profile
revealStreamKey:
  method: post
  requires: [{ rule: recentAuth, params: { intent: reveal_stream_key } }]
  output: StreamKey
legacy:
  method: get
  operationId: getTaskV1
  deprecated: { sunset: '2027-06-30', successor: getTask }
  upstream: [streaming, catalog]
  maturity: { level: experimental, reason: "Kept only for old clients." }   # the reason is optional
  output: Task
getDateDetail:
  method: get
  degradable: [viewerProgress]
  output: DateDetail
listInvoices:
  method: get
  paging: { springPage: { maxLimit: 100 } }   # a preset of @seampact/pack-spring
  item: Invoice
listChanges:
  method: get
  paging: { changes: { token: opaque } }      # the style of section 14
  item: Change
github:
  method: post
  path: 'github/{workspaceId}'                # quoted: braces open a flow mapping
  pathParams: { workspaceId: WorkspaceId }
  identity: github                            # signed, reads its key from path.workspaceId
  input: GithubEvent                          # tagged by X-GitHub-Event (ADR 0003 section 3)
  responses: { 204: {} }
move:
  method: post
  summary: 'Move the task to another project of the workspace.'
  requires: [{ right: tasks.update }]
  input: MoveTask                             # holds targetProjectId
  output: Task
  errors: { api.forbidden: {} }               # the handler checks the target project
health:
  method: get
  access: { public: "Probes call it before any user exists." }
  format: bare                                # the load balancer reads a bare body
  output: Health
```

A right never reads the body (section 4): it is decided before the body is validated. A check on a resource the body names, such as `move`'s target project, is the handler's: the route attaches the code the handler denies with, here `api.forbidden`, and the handler answers it as a typed error result (ADR 0012).

## Self-check: scenarios and keywords

Every FEAT-001 scenario that uses contract syntax, and the keywords it needs. Scenarios about targets, distribution or CI only (SCN-015, SCN-017, SCN-020 to SCN-025, SCN-027, SCN-028, SCN-049, SCN-052 to SCN-061, SCN-074, SCN-075, SCN-089 to SCN-095, SCN-098, SCN-099, SCN-103 to SCN-105, SCN-108, SCN-117, SCN-122 to SCN-130) use no syntax beyond what their fixture contract borrows from the rows below. SCN-072 (framework route allow-list) and the document choices of A43 are app configuration, ADR 0011 and 0012.

| Scenario | Keywords (section) |
|---|---|
| SCN-001 | `$include`, `routes`, `collection`, the byte-identity rule (2, 6) |
| SCN-002 | refused pitfalls P1 to P9, `$include` cycles (3) |
| SCN-003 | `kind: collection`, `id`, `item`, `concurrency.version`, `concurrency.field`, `ops`, `member`, `method` (6); the compiler adds `expectedVersion`, to the body of `updateTask` and to the query of `deleteTask` |
| SCN-004 | `owner: caller`, `ops` (6) |
| SCN-005 | `enums`, `enum` in a schema (12, ADR 0003) |
| SCN-006 | `examples` (`status`, `request`, `error`), `$file` (12, 2); refused keyword `if` (ADR 0003). The scenario's "TaskPage" example is the list payload, the item array, which the emitter wraps through the format |
| SCN-007 | the reasons of the safety exceptions: `access.public`, `optionalAuth`, `csrf.exempt`, `idempotency.exempt`, `unknownKeys`, `unknownQuery`, `opaque`, right `guest`; `lint.allow`; the optional reasons of `maturity`, enums and narrowings (4, 9 to 12). Every route lives under a surface, so the scenario's "route outside any surface" reads as a route under a surface with no identity |
| SCN-008 | `schemes` with `csrf`, `identities.schemes.write`, `csrf.exempt` (9) |
| SCN-009 | `identity`, `principal.requires`, `scopes`, `requires` (rule and right, a `requirements` entry), `input`, `bindings` (9) |
| SCN-010 | `bindings` with body and path sources (9) |
| SCN-011 | `errors` declared in the catalogue or on a node, attached with `{}` or narrowed with `{ example }`, `reach`, `for`, `conventions.errors.every`, `errorRoles`; `seampact explain` shows each code's origin (11, 16) |
| SCN-012 | `pagings` (`cursor`, `limit`, `sort` roles), `conventions.paging.default`, `paging.<style>.maxLimit`, `sortable`, `restrictedTo` (10, 14, ADR 0003) |
| SCN-013 | `cache.freshness`, `cache.etag`, `conventions.cache.families` with directives (10, 13) |
| SCN-014 | `workspace.apis`, `api.kind: service`, a relay route (`relays`, `operationId` to rename it), role bindings that differ between the two apis, `workspace.imports` (1, 5, 7) |
| SCN-016 | `extensions` (`at`, `schema`), the extension key pattern, `x-<prefix>-<key>` (12, 4) |
| SCN-018 | `lint.rules`, `lint.allow` (inherited, on catalogue entries), the core rule table, `maturity`, the `seampact/subtree-exception` rule; `sensitive` (12, 10, 8, ADR 0003) |
| SCN-019 | `api.compat.policy` (5) |
| SCN-026 | `schemes` of `kind: signature` (`name`, `verify`, `format`, `algorithm`, `payload`, `encoding`, `tolerance`, `key`, `headers`), `identities` of `kind: signed` (9) |
| SCN-029 | `extends`, duplicate definitions (2) |
| SCN-030 | `$ref` to a file, `$include` of a schema with a fragment, name-keyed schema files (2) |
| SCN-031 | `concurrency.version: query.<p>`, `concurrency: inherit` (6, 4). A33 accepts `header.If-Match`, which the scenario's acceptance criterion refused; the scenario follows A33 |
| SCN-032 | `api.version`, `surfaces.<s>.prefix` with `{version}`, `conventions.pathVersion`, a surface's `pathVersion` (5, 6, 13) |
| SCN-033 | `input` inline, derived names; `oneOf`, `discriminator` (7, ADR 0003, ADR 0007) |
| SCN-034 | `principal.requires` (9) |
| SCN-035 | `identity` inheritance, `routes` (8, 6) |
| SCN-036 | `access.public`, `requires` with `bucket`, `buckets` (9) |
| SCN-037 | `errors` (`status`, `nature`, `family`, `params`, `example`); the base natures and the `natures` catalogue; the error code pattern and `conventions.errors.pattern`; a code equal to a schema id or `<schema>.input` refused (ADR 0006 section 3) (11, 4, 13) |
| SCN-038 | `responses` with several 2xx and `headers`; redirect statuses with their derived `Location` (7, 3) |
| SCN-039 | `responses` 202 with `Location`, `Retry-After` (7) |
| SCN-040 | `ops.delete` with `output` (6) |
| SCN-041 | `conventions.bodyLimit`, `bodyLimit`, `conventions.batch`; `inputMedia: multipart` with `file` fields and their `maxSize`, `inputMedia: form`, a JSON text field (`contentMediaType`, `contentSchema`), a file download (13, 10, 7, ADR 0003) |
| SCN-042 | `conventions.idempotency` (`enforce` included), `idempotency.exempt` (13, 10) |
| SCN-043 | `budget` (10) |
| SCN-044 | `api.documents` with `internal: exclude`, `internal: true` (5, 10) |
| SCN-045 | `api.caller.right`, `rights.callerService.params` (5, 9) |
| SCN-046 | the optional `# yaml-language-server` modeline on every file and fragment, `init --modelines`, `init --editor-schemas`, `--no-modelines`, `--no-ignore-files`, `workspace.editorSchemas`, `compile --editor-schemas` (3) |
| SCN-047 | `packs`, pack file keys, `pack` manifest (1, 2) |
| SCN-048 | `formats` (`success.item`, `success.table`, `meta.fill`, `error`), a `pagings` style for the list, templates, `conventions.format`, `ops.batch` (13, 14, 6) |
| SCN-050 | `api.maturity`, `api.compat` (5) |
| SCN-051 | `deprecated.sunset`, `deprecated.successor` (10) |
| SCN-054 | `sensitive` (ADR 0003) |
| SCN-062 | `rights` (`params`, `subject.scope`, `subject.resource`, `subject.id`), default subject (9) |
| SCN-063 | `rights.guest`, `access.public`, any library right name, a right's `codeName`, `conventions.rights.pattern` (9, 4, 13) |
| SCN-064 | `extensions` with `at: [right]`, `x-<prefix>-<key>` on a right (12, 9) |
| SCN-065 | `restrictedTo` (ADR 0003), `access.public` (9) |
| SCN-066 | `conventions.restrictedInput`, per-field override (13, ADR 0003) |
| SCN-067 | `sortable` with `{ key, right }` (10) |
| SCN-068 | `filteredBy` (10) |
| SCN-069 | `scopes` catalogue with `within`, `scopes` on a node with `subdomain` and `path` sources (9, 4) |
| SCN-070 | `scopes` with `resolver` (9) |
| SCN-071 | `rights` (no syntax beyond SCN-062) |
| SCN-073 | `packs` with the CRUD rights pack, its `pack` manifest and `derive` entry (`select.op` with `batch`, `declareRight`, `require`), `ops`, the `requires` merge order (2, 6, 8) |
| SCN-076 | `identities.principal.variants`, `schemes.optionalRead` (9) |
| SCN-077 | `schemes` (`kind`: cookie, header, query, bearer, basic, signature; `name`, `csrf`, `bearerFormat`, `oauth2`, `openIdConnect`), `identities.schemes` (9) |
| SCN-078 | the `headers` catalogue with `deadline`, `traceContext`, `actorSurface`, their use on an identity, `budget` (9, 10) |
| SCN-079 | the `headers` catalogue in a pack (`semantic: versionToken`, `response`, `request`), the identity's use (`from`, `for`, `required`, `stale`) (9) |
| SCN-080 | `enums` (`values`, `source`, `reason`, `fallback`), narrowing (12, ADR 0003), `conventions.outputEnums` (13) |
| SCN-081 | `query` fields map with `?` and an object field, `conventions.query` (`lists`, `objects`, `unknownKeys`), `unknownQuery`, `conventions.input.unknownKeys` (7, 4, 13) |
| SCN-082 | a `pagings` style with the `since`, `nextSince` and `complete` roles, `paging.<style>.token`, `item` (10, 14) |
| SCN-083 | a `pagings` style with the `page` and `limit` roles, from a format pack or the contract, `paging.<style>.maxLimit`, `overLimit`, `item` (10, 14, 15) |
| SCN-084 | `ops.batch.maxIds`, `conventions.batch` (6, 13) |
| SCN-085 | `degradable`, `conventions.degradedHeader` or a format `degraded` meta field (10, 13) |
| SCN-086 | `access.optionalAuth` with `onRefused`, `cache.anonymous`, `cache.vary`, `cache.families` directives, `sensitive` (9, 10, 13) |
| SCN-087 | `services`, `upstream`, `maturity.level`, `maturity.reason`, `api.role: gateway` (10, 5) |
| SCN-088 | `summary`, `description` with `$file` (12, 2) |
| SCN-096 | `buckets` (`key`, `limit`, `window`), `rules.throttle.bucket`, `conventions.rateLimit` (9, 13) |
| SCN-097 | `rules.recentAuth.proof`, `params` (9) |
| SCN-100 | `packs`, the api-platform pack's `jsonld` format and `hydra` paging style (`$merge`, `$each`, the URL roles), `conventions.format`, `conventions.paging.default`; `resourceType`, `idProperty`, a schema's `typeName`, `conventions.urls` (2, 6, 13, 14, 15, ADR 0003) |
| SCN-101 | a list with neither `paging` nor `conventions.paging.default`; a `pagings` style mapping `page` and `lastPage` into a meta member (10, 14) |
| SCN-102 | every renamable default: `conventions.format`, `conventions.errors.derived`, `conventions.idempotency` names, `conventions.deprecation`, `conventions.pathVersion`, `conventions.query`, `conventions.int64`, `conventions.ops`, `conventions.operationIds`, `conventions.urls`; `codeName`, `codeNames` (13, 6, 12, ADR 0003) |
| SCN-106 | a relay route (`relays`) whose public operation has field rights (7) |
| SCN-107 | `pick` and `omit` with `from`, `fields`, `required`, `properties` (ADR 0003) |
| SCN-109 | an exception on a node above a route, the `seampact/subtree-exception` rule, `lint.allow` on that node (8, 12) |
| SCN-110 | the modeline of a fragment, `compile --editor-schemas`, `workspace.editorSchemas` (3, 1) |
| SCN-111 | `seampact explain <api>.<operationId>` (16) |
| SCN-112 | the `natures` catalogue (`base`), `nature` on a code (11) |
| SCN-113 | `pagings` styles with the `after`, `before` and `more` roles, `overLimit`, a `split` sort style (14, 10) |
| SCN-114 | a `signature` scheme with `verify: application` and `headers` (9) |
| SCN-115 | `access.optionalAuth` with `onRefused: reject` (9) |
| SCN-116 | `unknownKeys: { keep }` on an input use, `{ opaque }` (ADR 0003) |
| SCN-118 | `inputMedia: form`, a JSON text field with `contentMediaType` and `contentSchema`, a signed identity (7, 9) |
| SCN-119 | `inputMedia: multipart`, `file` fields with `media` and `maxSize`, `bodyLimit` (7, 10) |
| SCN-120 | a `file` as `output` or as a `responses` body (7) |
| SCN-121 | `responses` keyed 301, 302, 303, 307 or 308 (7, 3) |

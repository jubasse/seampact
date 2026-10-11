# ADR 0002: Authoring grammar

Status: accepted

## Context

A contract is written in YAML only (brief section 1). The grammar is the decision hardest to change later: every contract, the authoring JSON Schema, the loader, the compiler passes and the editor experience depend on it. Brief section 5.3 gives a first sketch and asks for the final grammar with a reason for each departure (open question 1 of section 18).

This ADR fixes every keyword a contract file may contain, outside the inside of a schema. The schema language itself (JSON Schema keywords kept and refused, direction, unions, marks such as `sensitive` and `restrictedTo`) is ADR 0003; this ADR only says where a schema may appear. What the compiler makes of the tree is the IR (ADR 0004) and the pass pipeline (ADR 0006). What a convention pack may set, and how packs and packages are resolved, is ADR 0008; this ADR defines the keywords they use.

Forces:

- One fact, one place (lesson 1). A grammar that lets the same fact be written twice needs a gate to hold the copies together.
- Deny by default, and a reason on every exception (brief section 7, FR-4).
- Nothing ahead of use (lesson 5): a keyword exists only if a checklist item or an amendment needs it.
- The core imposes no house convention: no header name, error code, right name, envelope or wire format (A20, A25, A30). These come from the contract's base file or from convention packs.
- Inline and included content must compile to the same bytes (FR-1, FR-9).
- The YAML must mean the same thing to every parser, in every language (FR-1).

## Options

1. Keep the sketch of section 5.3 as written.
2. Replace it with an OpenAPI-like flat list of paths and operations.
3. Keep the sketch's model (a tree mirroring the URL, catalogues of named declarations, `ops` shorthand, `requires`) and change what does not hold up once rights, scopes, signed webhooks, several apis and A30 are added.

Option 1 does not cover A18 to A25 (rights, scopes, neutral hooks) or A5 (signed webhooks), and some of its forms are ambiguous (children of a `single` mixed with settings keywords; `requires` items that cannot tell a right from a rule). Option 2 loses inheritance, which is what lets a contract state an identity, a scope or an error once for a whole subtree (brief section 5.2). Option 3 is chosen. Each departure from the sketch is listed with its reason in "Departures from brief 5.3".

## Decision

### 1. Files and the workspace

A contract workspace is a directory of YAML files with one entry file, `workspace.yaml`. A workspace with a single api may omit it; the CLI then takes the api file directly.

```yaml
# workspace.yaml
workspace:
  apis:
    tasks: ./tasks/api.yaml
    tasksService: ./tasks-service/api.yaml
  imports:
    storefront: { package: '@acme/contracts', version: 2.3.0, api: storefront }
```

- `workspace.apis` maps each api name to its api file. The names must equal each file's `api.name`. All apis of a workspace compile together, which is how `relays` reaches a sibling api (FR-8).
- `workspace.imports` names an api held in a pinned contract bundle, so a `relays` can target it without its sources. The bundle reference (`package`, `version`, or the other source forms) and its integrity check are ADR 0011.

There are five kinds of file. The loader knows each by its top-level keys.

| File | Top-level keys | Reached by |
|---|---|---|
| workspace | `workspace` | the CLI |
| api | `api`, `extends`, `packs`, `surfaces`, any catalogue, `conventions`, `formats`, `extensions`, `lint` | `workspace.apis` |
| base | any catalogue, `packs`, `conventions`, `formats`, `extensions` | `extends` from an api |
| pack | `pack`, any catalogue, `conventions`, `formats`, `extensions` | `packs` from an api or base |
| fragment | whatever the include site expects | `include` or a file `$ref` |

The catalogues are `schemas`, `enums`, `errors`, `natures`, `schemes`, `identities`, `rights`, `rules`, `scopes`, `buckets` and `services`. Each maps a name to one declaration. Everything a contract references by name lives in one of them.

Paths in `extends`, `packs`, `include`, `$ref` and `$file` are relative to the file that contains them, use forward slashes, must stay inside the workspace directory, and must match the case of the file on disk. The last two rules keep compilation identical on case-insensitive file systems and stop a contract from reading files outside its repository.

### 2. Composition: `extends`, `packs`, `include`, `$ref`, `$file`

- `extends: ./base.yaml`. An api extends at most one base. The base's catalogues, conventions, formats and extensions join the api's. A base does not extend another base; shared declarations beyond one level travel as packs. A name defined in both the api and its base is an error naming both locations, even when the two definitions are identical (fix: "remove the copy", SCN-029).
- `packs: ['@seampact/pack-crud-rights', ./packs/house.yaml]`. A list of convention packs, applied in order. A string starting with `./` or `../` is a path; any other string is a package name, resolved as ADR 0008 says. A pack is data only: a pack file containing anything but the keys above is refused (SCN-047). Two packs defining the same catalogue name is an error. A `conventions` key set by a pack may be set again by the base or the api, which wins, and the IR records where the value came from; a key set by both the base and the api is an error.
- `include: <path>` or `include: [<path>, ...]` is organisational. It may appear as a key of any mapping except a mapping of named tree nodes (`routes`). Each included file holds a mapping, which is merged in place into the mapping that holds `include`. A key defined twice, by two files or by a file and a sibling key, is a duplicate-key error. An included schema is an inline copy at the include site, not a reference (SCN-030).
- `$ref` names an addressable element and keeps its identity: the IR holds one copy and every use points to it (SCN-030). Its value is a name (`Task`), a pointer into the api's merged catalogues (`'#/schemas/Task'`), or a file (`./schemas/task.yaml`, or `./schemas/task.yaml#/schemas/Task`). A file `$ref` without a fragment is valid when that file declares exactly one element of the expected catalogue, under its name. A file reached only through `$ref` adds the referenced element, and what it references, to the api; its other declarations are not added. `#` always means the api's merged catalogues (api, base, packs, included pieces), not the physical file, because a base must reference schemas that the api declares and the reverse.
- In a position that expects a schema, a plain string is a `$ref`: `output: Task` means `output: { $ref: Task }`. Other references are names in typed positions (`identity: user`, `right: tasks.update`, `errors: [api.forbidden]`, `enum: Role`), so they need no `$ref`.
- `$file: <path>` replaces the value that holds it with a file's content: a `.md` or `.txt` file gives a string (docs), a `.json` or `.yaml` file gives data (examples). A `.yaml` file read this way goes through the same pitfall checks as any contract file. A missing file is a located error (SCN-088).

#### The byte-identity rule

A route declared inline and the same route moved to a file reached through `include` compile to byte-identical IR (FR-1, FR-9, SCN-001). The grammar guarantees it with five rules:

1. The IR never depends on the order of keys in a mapping, nor on which file a node came from. Order is meaningful only in sequences, and `include` never reorders one. ADR 0004 lists the sequences whose order the IR keeps (`requires`, `upstream`, enum `values`, among others) and sorts every other sequence as a set.
2. `include` replaces itself with the file's mapping before any other step; after it, the tree is the same as if the content had been written inline.
3. Relative paths inside an included file resolve against that file, so moving content and fixing its relative paths reaches the same files; the IR stores the content of `$file` and `$ref` targets, never a path.
4. Names that the compiler derives (operation ids, inline schema names, ADR 0007) come from the position in the tree and the role, never from a file name.
5. Source locations (file, line, column) live only in the side table (ADR 0004). An element's `origin` in the IR is a logical path in the tree, such as `surfaces.app.routes.channels.member.routes.tasks`, which does not change when content moves between files.

The loader's property test externalises random nodes of generated trees and asserts byte equality of the IR.

### 3. YAML subset and refused pitfalls

Files are parsed as YAML 1.2 with the core schema, then checked against the authoring JSON Schema (FR-9). The loader refuses, each with file, line, column, rule and fix (FR-1, SCN-002):

| Refused | Example | Fix |
|---|---|---|
| A plain scalar whose type differs between YAML 1.1 and 1.2 | `y`, `n`, `yes`, `no`, `on`, `off` (any case), `1:30` (sexagesimal), `2027-06-30` (timestamp), `1e3` | quote it |
| An anchor, an alias or a merge key, anywhere | `&base`, `*base`, `<<:` | use `$ref` or `extends` |
| A scalar whose type differs from the one the authoring schema expects | `version: '1'`, `name: 12` | write the expected type |
| A duplicate key | two `tasks:` in one mapping, or once inline and once through `include` | remove the duplicate |
| A cycle of `include`, `$ref` files or `extends` | `a.yaml` includes `b.yaml`, which includes `a.yaml` | break the cycle |
| More than one document in a file, or a tag | `---` twice, `!!str` | one document per file; no tags |

No keyword of the grammar is a word that YAML 1.1 reads as a boolean (`on`, `off`, `yes`, `no`), so a keyword never needs quoting. A plain mapping key is a string, except in a mapping keyed by HTTP status (`responses`), where keys are plain integers from 100 to 599. A `# yaml-language-server: $schema=...` comment is the only comment with a meaning, and only to editors: `seampact init` writes it (FR-9, SCN-046).

### 4. Scalars, names and value sources

- Durations: an integer followed by `ms`, `s`, `m`, `h` or `d` (`300ms`, `15m`, `24h`). Sizes: an integer followed by `B`, `KiB` or `MiB` (`1MiB`). Dates: a quoted ISO 8601 date (`'2027-06-30'`); unquoted it is a YAML 1.1 timestamp and refused.
- Reasons: a non-empty string. Every exception takes one (section 9).
- Name patterns, checked by the authoring schema:

| Element | Pattern | Examples |
|---|---|---|
| schemas, enums | `^[A-Z][A-Za-z0-9]*$` | `Task`, `TaskId` |
| apis, surfaces, tree nodes, operation ids, identities, schemes, scopes, rules, buckets, services, formats, natures, cache families, documents | `^[a-z][A-Za-z0-9_]*$` | `tasks`, `viewer_or_device`, `five_minutes` |
| rights | `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$` | `roles`, `tasks.update` |
| error codes | `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$` | `api.forbidden`, `state.conflict` |
| extension prefixes | `^[a-z][a-z0-9]*$`, `seampact` reserved | `acme` |

  The core constrains a right only by its pattern; it imposes no naming convention (A20, SCN-063). An error's family is its code up to the first dot (FR-6).
- A fields map maps names to schemas. A field is required unless its name ends with `?`: `query: { limit?: { type: integer }, cursor?: Cursor }`. Fields maps are used for `id`, `pathParams`, `query`, `headers`, and the `params` of errors, rights and rules. In each of these places a string instead of a mapping names a schema whose properties are the fields (`query: TaskQuery`).
- Value sources name where a value is read. One grammar serves every use; each use accepts a subset:

| Source | Meaning |
|---|---|
| `path.<param>` | a path parameter |
| `query.<param>` | a query parameter |
| `header.<Name>` | a request header (case-insensitive) |
| `body.<field>[.<field>...]` | a field of the parsed body |
| `principal.<field>[.<field>...]` | a field of the authenticated principal |
| `scope.<scope>` | a resolved tenancy scope |
| `host`, `subdomain` | the request host, or its first label |
| `address`, `address/<bits>` | the client address, or its prefix (`address/64`) |
| `resolver` | an application-implemented resolver (scopes only) |

| Use | Accepted sources |
|---|---|
| requirement `subject` | path, query, header, principal, scope (never body: rights are decided before body validation, FR-5) |
| scope id (`scopes` on a node) | path, query, header, host, subdomain, principal, resolver (A23) |
| `bindings` key / value | path, query, body / principal |
| `concurrency.version` | body, query (a header such as `If-Match` is refused, SCN-031) |
| bucket `key` | address, address prefix, principal, body |
| signature `key` | path, query, header |

### 5. The api file

```yaml
# tasks/api.yaml (excerpt)
api:
  name: tasks
  version: 1
  kind: surface
  maturity: provisional
  summary: Tasks shared inside channels.
  description: { $file: ./docs/api.md }
  compat: { policy: additive-only }
  documents:
    public: { internal: exclude }
    full: {}
extends: ../shared/base.yaml
```

| Key | Meaning |
|---|---|
| `name` | the api name, unique in the workspace |
| `version` | an integer; the path version derives from it (section 6) |
| `kind` | `surface` (default) or `service` |
| `role` | `gateway`: every route derives 502, 503 and 504 from the conventions' error slots (FR-34) |
| `caller` | service apis only: `{ identity, right }`; see below |
| `maturity` | `experimental`, `provisional` or `stable`; the default maturity of every operation |
| `compat` | `{ policy: additive-only }` or `{ policy: none }`; gates releases and `maturity: stable` (FR-13, SCN-019, SCN-050) |
| `documents` | the OpenAPI documents to emit; see below |
| `summary`, `description` | docs; `description` may be a `$file` |

A service api (FR-8, section 9 of the brief) states `caller: { identity: service, right: callerService }`. Every route of it runs under that identity, which its surfaces need not repeat and no node may change; a public or optional-auth route is a compile error; a route whose `requires` does not include `caller.right` is a compile error (SCN-014, SCN-045). The names are the contract's own (A20): the core knows only that this api has a caller identity and a caller right.

`documents` declares named OpenAPI documents. Each entry takes `surfaces` (the surfaces it covers, default all) and `internal` (`include`, the default, or `exclude`). An api with no `documents` emits one document holding every route (SCN-044). Where each document is written is consumer configuration (ADR 0011).

### 6. Surfaces and the tree

`surfaces` maps a surface name to the root node of a tree. A surface is a named entry point with a path prefix and, usually, a default identity.

```yaml
# tasks/api.yaml (excerpt)
surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes:
      health:
        method: get
        access: { public: "Probes call it before any user exists." }
        output: Health
```

`prefix` is the surface's leading path. `{version}` is replaced by `api.version`. A prefix with no `{version}` gets `/v{version}` in front of it. A literal version segment such as `/v1` is refused, with the mismatch stated when it differs from `api.version` (FR-2, SCN-032); the version is held once, on the api.

Every node is a mapping of settings plus its children. There are three kinds of node:

| Node | Marked by | Children |
|---|---|---|
| route | `method` | none |
| collection | `kind: collection` | `ops`, `collection`, `member` |
| single | `kind: single` | `ops`, `routes` |

A surface root, a single, and the `collection` and `member` scopes of a collection hold their children under `routes`, a mapping from child name to node. The child name is written in the parent file even when its content is included (`search: { include: ./routes/tasks/search.yaml }`), so every route stays discoverable from its parent (brief 5.1).

A node's path segment is its name, converted by `conventions.pathCase` (`kebab`, the default, `camel` or `snake`). `path` replaces the segment: it is relative to the parent, has no leading slash, may be empty, and may hold `{param}` placeholders declared in `pathParams`.

#### Collections and singles

```yaml
# tasks/api.yaml (excerpt: a node under routes)
tasks:
  kind: collection
  id: { taskId: TaskId }
  item: Task
  concurrency: { version: body.expectedVersion, field: version }
  ops: [list, get]
  collection:
    routes:
      search: { include: ./routes/tasks/search.yaml }
  member:
    scopes: { task: path.taskId }
    routes:
      assign: { method: post, input: AssignTask, output: Task }
```

| Key | On | Meaning |
|---|---|---|
| `id` | collection | a fields map with one entry: the member id path parameter and its schema |
| `item` | collection, single | the schema of one record |
| `owner` | collection, single | `caller`: see write semantics |
| `concurrency` | collection, single | `{ version: <body or query source>, field: <item field> }`; on a member route, `concurrency: inherit` |
| `ops` | collection, single | the shorthand routes; see below |
| `collection` | collection | a node for the collection scope (`/tasks`): settings plus `routes` |
| `member` | collection | a node for the member scope (`/tasks/{taskId}`): settings plus `routes` |
| `routes` | single, surface, `collection`, `member` | the named children |

Settings written on the collection node apply to all its routes; settings written in `collection` or `member` apply to that scope only. That is how a scope id read from the member path (`path.channelId`) applies to member routes and not to the list.

#### The `ops` shorthand

`ops` expands to ordinary routes; the IR holds only routes (brief 5.2). It is either a list of op names or a mapping from op name to settings for that op; the list `[get, update]` is the mapping `{ get: {}, update: {} }`.

| Op | On | Method and path | Operation id | Input | Success |
|---|---|---|---|---|---|
| `list` | collection | `GET /tasks` | `list` + plural (`listTasks`) | the paging query | `200`, a page of `item` |
| `get` | collection, single | `GET /tasks/{taskId}`, `GET /me/preferences` | `get` + singular (`getTask`, `getPreferences`) | none | `200`, `item` |
| `create` | collection | `POST /tasks` | `create` + singular | required `input` | `201`, `item` |
| `update` | collection, single | `PATCH /tasks/{taskId}` | `update` + singular | required `input` | `200`, `item` |
| `delete` | collection, single | `DELETE /tasks/{taskId}` | `delete` + singular | none | `204`, or `200` with `output` (SCN-040) |
| `batch` | collection | `POST /tasks/batch` | `get` + plural + `Batch` (`getTasksBatch`) | `{ ids }`, at most `maxIds`, or a declared `input` | `200`, a table of `item` keyed by id |

The plural is the collection's name; the singular is the id parameter's name without its trailing `Id` (`taskId` gives `task`), or the whole parameter name when it has no such suffix. For a single, the noun is the single's name. Any op's settings may override `method`, `path`, `operationId`, `input`, `output`, `responses` and every node setting. `create` and `update` have no default input, because the item schema holds fields a client never sends; the missing input is a compile error naming the op. No other shorthand exists until a consumer needs one (lesson 5).

A `batch` op is a safe read sent as POST: the IR marks it safe, so CSRF, idempotency and cache derivations treat it as a read. Its `maxIds`, body limit and budget default to `conventions.batch` (FR-32, SCN-084).

Operation ids of other routes: a route under `member` is its name plus the singular (`assign` gives `assignTask`); under `collection`, its name plus the plural (`search` gives `searchTasks`); under a single, its name plus the single's name; under a surface root, its name. `operationId` replaces the derived id. Operation ids are unique across the api; a clash is a compile error naming both routes. Names are stored as word segments (ADR 0007).

#### Write semantics

Kept from Arthome (brief 5.2, FR-2):

- `owner: caller`: the caller owns the records. On a collection, another caller's id answers 404 (derived), with no version and no 409; on a single, nothing is derived (SCN-004).
- Otherwise a write may be versioned: `concurrency: { version: body.expectedVersion, field: version }`. `update` and `delete` inherit it; a member route only with `concurrency: inherit` (SCN-003, SCN-031). The route's input must hold the `version` field (a body field or a query parameter) and the item schema must hold `field`; either missing is a compile error naming the field. A stale write derives `409` from the `stateConflict` slot. `If-Match` is not supported until a consumer needs it.
- DELETE when the record disappears; an action (`POST .../archive`) when it stays with a new state.

### 7. Routes

```yaml
# tasks/api.yaml (excerpt: a member route)
assign:
  method: post
  summary: Assign the task to a member of the channel.
  requires:
    - { right: roles, params: { allowed: [owner, editor] } }
  input:
    type: object
    required: [userId]
    properties: { userId: UserId }
  output: Task
```

| Key | Meaning |
|---|---|
| `method` | `get`, `post`, `put`, `patch` or `delete` |
| `path`, `pathParams` | the segment and the schemas of its extra placeholders (all required) |
| `operationId` | replaces the derived id |
| `query` | a fields map, or a schema name; an object-typed field is exploded into top-level keys, and any undeclared key is refused (FR-30) |
| `headers` | request headers: a fields map keyed by header name |
| `input` | the body schema (`application/json`) |
| `output` | the single success response: its status is the op's default, or `200` |
| `responses` | several responses keyed by status, instead of `output` |
| `paging`, `sortable`, `filteredBy` | list behaviour (section 10) |
| `degradable` | optional success-data paths that may be missing (FR-32) |
| `relays` | `<api>.<operationId>`: the public operation this service route serves (FR-8) |
| `examples` | named examples (section 12) |
| `summary`, `description` | docs |

Query wire kinds (number, boolean, list, text, object) derive from each field's schema type and need no keyword (FR-30, SCN-081).

`responses` maps a status to `{ body, headers, description }`; `headers` is a fields map of response headers keyed by name. It serves several 2xx on one route (SCN-038), a `202` with `Location` and `Retry-After` (SCN-039) and a `DELETE` answering 200 with a body (SCN-040). Only success responses are written here; error responses come from error codes (section 11).

```yaml
# tasks/api.yaml (excerpt: a member route)
export:
  method: post
  responses:
    202:
      headers: { Location: Url, Retry-After: RetryAfterSeconds }
```

### 8. Inherited settings

Every node may set the settings below; its descendants inherit them, and the IR records the node each one came from (FR-2, SCN-003, SCN-035). No other state is global.

| Setting | Merge rule down the tree |
|---|---|
| `identity`, `access` | the nearest wins; `access` and `identity` replace each other |
| `requires` | appended: ancestors first, then the node's own; the same right or rule twice with equal params is an error |
| `scopes` | added; entering a scope twice is an error |
| `principal.requires` | union |
| `bindings` | added; one key bound to two different values is an error |
| `errors` | union; an example override from the nearest node wins |
| `tags` | union |
| `headers`, `query` | added; one name declared twice is an error |
| `upstream`, `maturity`, `internal`, `deprecated`, `budget`, `bodyLimit`, `cache`, `csrfExempt`, `idempotency`, extension keys | the nearest wins |

`owner`, `concurrency`, `ops`, `paging`, `sortable`, `filteredBy`, `degradable`, `relays`, `examples` and docs are not inherited. An inherited requirement cannot be removed below; a route that needs fewer requirements belongs elsewhere in the tree. This keeps every requirement of a route visible in its ancestry.

### 9. Access, identities, rights, rules, scopes

#### Access on a node

- `identity: <name>`: the route requires that identity. A surface usually sets it once.
- `access: { public: "<reason>" }`: no authentication; the principal is null.
- `access: { optionalAuth: "<reason>" }`: an anonymous caller or the inherited identity. A presented credential that fails answers 401.
- `access: { optionalAuth: "<reason>", refusedAsAnonymous: "<reason>" }`: a refused credential is treated as anonymous instead of 401 (Arthome's sign-out).
- `csrfExempt: "<reason>"`: no CSRF check on a cookie write.

A route that resolves to neither an identity nor a public access is a compile error that names both fixes (FR-4, SCN-007). A public child under an identified parent still needs its reason (SCN-035).

#### Security schemes

```yaml
# shared/base.yaml (excerpt)
schemes:
  sessionCookie: { kind: cookie, name: __Host-session, csrf: csrfToken }
  csrfToken: { kind: header, name: X-Csrf-Token }
  bearer: { kind: bearer }
  deviceToken: { kind: header, name: X-Device-Token }
  internalToken: { kind: bearer, format: jwt }
```

`kind` is `cookie`, `header` (an API key in a header), `bearer` (HTTP bearer) or `signature` (A5). `name` is the cookie or header name. `csrf` on a cookie scheme names the header scheme a cookie write must also present; CSRF is derived from it, never written on an identity (FR-27, SCN-008, SCN-077). A `signature` scheme declares (details and test vectors: ADR 0013):

```yaml
# shared/base.yaml (excerpt)
schemes:
  stripeSignature:
    kind: signature
    header: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }
```

`format` holds `{sig}` and optionally `{ts}` and `{kid}`; `payload` holds `{rawBody}` and optionally `{ts}` and `{kid}`; `tolerance` is required when `{ts}` is used; `key` is `{ value: <literal> }` or `{ from: <path, query or header source> }`, the key identifier the application's secret lookup receives (FR-20).

#### Identities

```yaml
# shared/base.yaml (excerpt)
identities:
  viewer:
    schemes:
      read: [sessionCookie, bearer]
      write: [sessionCookie, bearer]
      optionalRead: [deviceToken]
    principal: ViewerPrincipal
  viewer_or_device:
    schemes: { read: [sessionCookie, bearer, deviceToken] }
    principal:
      variants: { viewer: ViewerPrincipal, device: DevicePrincipal }
  stripe:
    kind: signed
    scheme: stripeSignature
    principal: WebhookCaller
```

| Key | Meaning |
|---|---|
| `kind` | `credential` (default) or `signed` |
| `schemes.read`, `schemes.write` | the schemes accepted on reads and on writes; `write` defaults to `read` |
| `schemes.optionalRead` | extra schemes accepted on optional-auth reads only (FR-27, SCN-076) |
| `scheme` | `signed` only: the one `signature` scheme; the compiler forces a raw body and removes CSRF and idempotency keys (FR-20, SCN-026) |
| `principal` | the principal schema, or `{ variants: { <name>: <schema> } }` for an identity accepting several credential kinds; hooks and handlers narrow on the variant name |
| `errors` | codes attached to every route of the identity |
| `headers` | identity headers, below |

Identity headers (FR-28) map a local name to `{ name, in, for, required, schema, semantic }`. `in` is `request` or `response`; `for` is `all`, `reads` or `writes`; `required` defaults to `false`. `semantic` lets targets generate behaviour: `deadline` (an instant; the client computes it from the budget, the server exposes the remaining time and answers 504 from the `deadlineExceeded` slot once it has passed), `traceContext` (relayed, never refused when malformed), `actorSurface` (a strict enum; its `schema` names it). A `versionToken` entry has its own shape, because one fact drives two headers:

```yaml
# studio/base.yaml (excerpt)
identities:
  operator:
    schemes: { read: [sessionCookie], write: [sessionCookie] }
    principal: OperatorPrincipal
    headers:
      rightsVersion:
        semantic: versionToken
        from: principal.rightsVersion
        response: { name: X-Rights-Version }
        request: { name: If-Rights-Version, for: writes, required: false }
        stale: api.rights_version_stale
```

The header names are the contract's or a pack's, never the core's (SCN-079).

#### Principal requirements and bindings

```yaml
# tasks/api.yaml (excerpt: route settings)
principal: { requires: [profileId] }
bindings: { body.profileId: principal.profileId, path.profileId: principal.profileId }
```

`principal.requires` lists principal fields that must be present; a principal without one answers 403 after authentication, and the handler receives the field as non-optional (SCN-034). `bindings` maps a request value to a principal field; a mismatch answers 403 before the handler (SCN-010). Both answers use the `forbidden` slot unless the conventions name another code.

#### Requirements

`requires` is an ordered list. Each item names either a right or a rule (FR-5):

```yaml
# tasks/api.yaml (excerpt: route settings)
requires:
  - { rule: throttle, bucket: write }
  - { right: roles, params: { allowed: [owner, editor] } }
  - { right: tasks.update }
  - { right: tasks.update, subject: path.taskId }
```

| Key | Meaning |
|---|---|
| `right` or `rule` | the catalogue name |
| `params` | the values of the right's or rule's typed params |
| `subject` | rights only: a value source; see below |
| `bucket` | rules declared with `bucket: true` only: a bucket name |

The check order is fixed (FR-5): transport refusals, authentication, principal requirements, scopes in nesting order, requirements in the order of this list, input validation, bindings, the handler. A requirement may sit on a public or optional-auth route; its hook then receives a null principal (SCN-036).

#### Rights

```yaml
# shared/base.yaml (excerpt)
rights:
  roles:
    params: { allowed: { type: array, items: { enum: Role }, minItems: 1 } }
    subject: { scope: channel }
  tasks.update:
    subject: { resource: Task, id: TaskId }
    errors: [api.forbidden, api.not_found]
  articles.read:
    subject: { resource: Article, id: ArticleId }
    guest: "Published articles are readable without an account."
```

| Key | Meaning |
|---|---|
| `params` | a fields map or a schema name; typed in the decide request |
| `subject` | absent (none), `{ scope: <scope> }`, or `{ resource: <Name>, id: <id schema> }` |
| `guest` | a reason; required for the right to appear on a public route (SCN-063) |
| `errors` | the denial codes the decide hook may answer; default the `forbidden` slot |
| `summary`, `description`, extension keys | docs and consumer metadata that reach the generated boundary (A20, SCN-064) |

At the use site, a resource subject defaults to the nearest member id whose schema is the right's `id` schema (`path.taskId` for `tasks.update` under `tasks`); otherwise `subject` is required. The source's schema must equal the subject's id schema (SCN-062). A scope subject takes the route's resolved scope; a route without that scope is a compile error. Roles, permissions and custom questions are all rights (FR-22); naming conventions and derived rights come only from opt-in packs (FR-26, SCN-073).

#### Rules

```yaml
# shared/base.yaml (excerpt)
rules:
  throttle:
    bucket: true
    errors: [api.rate_limited]
  recentAuth:
    params: { intent: { enum: ReauthIntent } }
    proof: { in: body, name: reauthToken, schema: ReauthToken }
    errors: [api.reauthentication_required]
```

A rule is a pre-handler check that is not a right: no subject, no use on fields, sort keys or lists. `params` and `errors` are as for rights. `bucket: true` makes each use name a bucket, whose key sources and limits reach the decide hook; the 429 reply and its `Retry-After` come from the conventions (FR-41, SCN-096). `proof` declares a value the rule reads from the request (`in: body` or `in: header`): the compiler adds the field to the route's input once, marks it sensitive, and refuses a body proof on a route without a body (SCN-097).

#### Buckets

```yaml
# shared/base.yaml (excerpt)
buckets:
  signInPerEmail: { key: [body.email, address], limit: 10, window: 15m }
  export: { key: [principal.accountId] }
```

`key` lists the sources counted; `limit` and `window` may be left for the server to bind, and the compiler then warns (SCN-096).

#### Scopes

```yaml
# shared/base.yaml (excerpt)
scopes:
  org: { id: OrgId, errors: [api.not_found] }
  project: { id: ProjectId, within: org, errors: [api.not_found] }
  tenant: { id: TenantId, errors: [api.forbidden] }
```

A scope catalogue entry declares the id schema, an optional parent scope (`within`) and the membership denial codes. A node enters scopes with `scopes`, a mapping from scope name to a value source:

```yaml
# tasks/api.yaml (excerpt: node settings)
scopes: { org: subdomain, project: path.projectId }
```

`resolver` means the application implements the resolver (A23, SCN-070). Scopes resolve in nesting order: a scope entered at an ancestor before one entered below it; inside one node, a parent scope before its child, then by name. A scope entered below its own child scope is an error (FR-24, SCN-069).

### 10. Lists, cache and lifecycle settings

- `paging`: on a list op or any GET route returning several records (its `output` is then the item schema): `cursor`, `pages`, `changesSince`, or the mapping form `{ cursor: { maxLimit: 50 } }`, `{ pages: { maxLimit: 100 } }`, `{ changesSince: { token: opaque } }` (`token: opaque` or `token: instant`). A list without `paging` uses `conventions.paging.default`; `paging: { none: "<reason>" }` opts out. Where the paging state travels (query parameters, page fields, headers) is the wire format's (section 13). `changesSince` derives 410 from the `gone` slot (FR-31, SCN-012, SCN-082, SCN-083).
- `sortable`: a list of item fields, each a name or `{ key, right }`. A key inherits its field's `restrictedTo`; an explicit right that disagrees is a compile error; sorting by a restricted key without the right derives 403 from the `sortKeyForbidden` slot (FR-23, SCN-067).
- `filteredBy: <right>`: the right the application applies to its query; it reaches OpenAPI and the handler context, and nothing enforces it (SCN-068).
- `degradable: [viewerProgress]`: paths of optional properties of the success data; a required one is a compile error (SCN-085).
- `cache: { freshness: minute, anonymous: public, vary: [Cookie, Authorization], etag: true }`. `freshness` is a family from `conventions.cache.families` or `never` (no-store); `anonymous` (`public` or `private`) applies to anonymous callers only, since an identified caller always gets private; `etag: true` generates conditional GET (FR-33, SCN-013, SCN-086).
- `budget: 300ms`: the client's default timeout and the deadline sent on an identity with a `deadline` header (SCN-043, SCN-078).
- `bodyLimit: 2MiB`: overrides `conventions.bodyLimit` (SCN-041).
- `idempotency: { exempt: "<reason>" }`: a write without the idempotency key (SCN-042).
- `internal: true`: keeps the route out of documents with `internal: exclude` (surface apis only, SCN-044).
- `upstream: [streaming, catalog]`: services from the `services` catalogue, the owning service first. The operation's maturity derives from the owning service, otherwise from `api.maturity` (FR-34).
- `maturity: { level: experimental, reason: "<reason>" }`: a stated maturity; it must differ from the derived one (SCN-087).
- `deprecated: { sunset: '2027-06-30', successor: getTask }`: derives the Deprecation, Sunset and successor Link headers (FR-13, SCN-051).
- `tags: [tasks]`.

```yaml
# shared/base.yaml (excerpt)
services:
  catalog: { maturity: stable }
  streaming: { maturity: provisional }
```

### 11. Errors and natures

```yaml
# shared/base.yaml (excerpt)
errors:
  api.forbidden: { status: 403, nature: refused, title: The caller may not do this. }
  api.rate_limited:
    status: 429
    nature: unavailable
    params: { retryAfterMs: { type: integer, minimum: 0 } }
    example: { retryAfterMs: 1500 }
```

The registry defines each code once: `status`, `nature`, `params` (a fields map or a schema name), `example` (the params), `title`, `description` (FR-6, SCN-037). Codes reach operations only by attachment, at three levels: `conventions.errors.every` (every operation), `errors` on a tree node (inherited), and `errors` on a route. An attachment is a code, or `{ code, example }` to override the example only; redefining `status`, `nature` or `params` anywhere but the registry is an error naming the registry location (SCN-011). Rights, rules, scopes and identities attach their own codes, with `derivedFrom` in the IR.

`nature` is a closed set that tells a client whether retrying can help: `refused` (retrying the same request cannot succeed), `unavailable` (retrying later may succeed) and `failed` (the server failed). A pack or base may add a nature only by mapping it onto one of the three, so every client keeps its retry rule (SCN-037):

```yaml
# packs/house.yaml (excerpt)
natures:
  offline_forbidden: { like: refused, description: The action needs a connection. }
```

Derived errors use slots, never fixed codes. `conventions.errors.derived` maps each slot to a registry code; a derivation whose slot has no code is a compile error naming the slot. The slots: `unauthenticated` (401), `csrfInvalid`, `forbidden`, `sortKeyForbidden` (403), `notFound` (404), `schemaInvalid` (400), `payloadTooLarge` (413), `unsupportedMediaType` (415), `stateConflict`, `idempotencyKeyReused`, `idempotencyInProgress` (409), `gone` (410), `rateLimited` (429), `undeclaredStatus` (500), `upstreamUnavailable` (502), `serviceUnavailable` (503), `upstreamTimeout`, `deadlineExceeded` (504). The derivation table that uses them is ADR 0006.

### 12. Enums, examples, docs, extensions, lint

```yaml
# shared/base.yaml (excerpt)
enums:
  Role: { values: [owner, editor, viewer], reason: Roles are local to this product. }
  PublicationState: { values: [draft, published, withdrawn], source: { vocabulary: domain.publication } }
  ErrorNature: { values: [refused, unavailable, failed], fallback: unavailable, reason: Mirrors the core natures. }
  Answer: { values: ['yes', 'no'], reason: A survey answer. }
```

An enum declares `values` (strings, unique) and either `source` (`{ vocabulary: <name> }` for an external vocabulary, or `{ enum: <Enum> }` to take another enum's values) or, for a local enum, `reason` (FR-29). `fallback` names the member a client decoder maps an unknown value to (SCN-080). Narrowing happens at a use, inside a schema (ADR 0003). Members such as `yes` and `no` must be quoted (section 3).

Examples are named, on a route, and parsed against their schema at compile time (FR-3, SCN-006):

```yaml
# tasks/api.yaml (excerpt: route settings)
examples:
  firstPage: { status: 200, value: { $file: ./examples/search-200.json } }
  missingTitle: { request: true, value: { title: '' } }
```

An example targets a success status or the request (`request: true`); error examples live in the registry. Schema examples are ADR 0003.

Docs are `summary` (inline) and `description` (inline or `$file`) on apis, nodes, routes, errors, rights, rules, scopes, identities and enums; schemas use JSON Schema's `title` and `description` (FR-34, SCN-088).

Consumer extension keys (FR-10, SCN-016) are declared with a JSON Schema under a prefix:

```yaml
# shared/base.yaml (excerpt)
extensions:
  acme:
    tax-basis:
      at: [operation, property]
      schema: { enum: [inclusive, exclusive] }
```

`at` lists where the key may appear: `api`, `operation` (any tree node, inherited), `schema`, `property`, `right`, `rule`, `scope`. The key is written `x-<prefix>-<key>` at its place of use (`x-acme-tax-basis: inclusive`). A core keyword never starts with `x-`, so an extension never collides with one, and no domain key becomes a core keyword (SM-6). The compiler validates every value with a located diagnostic.

`lint: { allow: { <rule id>: "<reason>" } }` on any node, schema or property silences one lint rule there (FR-12, SCN-018).

### 13. Conventions and wire formats

`conventions` holds the api-wide settings a pack usually supplies. What a pack may set, and the defaults, are ADR 0008.

```yaml
# shared/base.yaml (excerpt)
conventions:
  format: bare
  pathCase: kebab
  paging: { default: cursor, maxLimit: 100 }
  idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetime: 24h }
  bodyLimit: 1MiB
  batch: { maxIds: 200, bodyLimit: 2MiB, budget: 150ms }
  cache: { families: { minute: 60s, five_minutes: 300s } }
  restrictedInput: reject
  outputEnums: enum
  rateLimit: { retryAfterHeader: Retry-After }
  errors:
    every: [api.internal]
    derived: { unauthenticated: api.unauthenticated, forbidden: api.forbidden }
```

| Key | Meaning |
|---|---|
| `format` | the wire format, `bare` by default (A30) |
| `pathCase` | how node names become path segments |
| `paging` | the default paging kind, `maxLimit`, `defaultLimit` |
| `idempotency` | the key header, its replay header and its lifetime (FR-7) |
| `bodyLimit`, `batch` | the default body limit (1 MiB) and the batch defaults |
| `cache.families` | freshness families and their max-age |
| `restrictedInput` | `reject` (default) or `strip`: a restricted field sent without its right (A21); overridable per field (ADR 0003) |
| `outputEnums` | `enum` or `open`: how the emitter writes an output enum (FR-29) |
| `rateLimit` | the header carrying the retry delay on 429 |
| `degradedHeader` | the header listing degraded parts, for a format without a meta slot |
| `errors.every`, `errors.derived` | section 11 |

The core imposes no wire format (A30). With `format: bare`, the default, a success body is the bare payload, a list is the bare array with its paging state in RFC 8288 `Link` headers, and an error is an RFC 9457 `application/problem+json` body whose `code` member is the discriminator, with `nature` and the error's params as further members. Every other format (an envelope like Arthome's, JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring Page and ProblemDetail) is declared by a convention pack in `formats` and selected with `conventions.format`; each target maps it onto its framework's own mechanism (FR-42, SCN-048, SCN-100).

```yaml
# packs/acme-envelope.yaml (excerpt)
formats:
  acmeEnvelope:
    media: application/json
    success:
      item: { data: $payload, meta: $meta }
      page: { items: $payload, page: $page, meta: $meta }
      table: { data: $payload, meta: $meta }
    meta:
      servedAt: { fill: now }
      degraded: { fill: degraded }
    page:
      cursor: { next: $nextCursor, limit: $limit }
    error:
      media: application/json
      body: { error: { code: $code, nature: $nature, params: $params, traceId: $traceId } }
```

A format is a set of templates. A string starting with `$` in a template is a slot the boundary fills: `$payload`, `$meta`, `$page`, `$code`, `$nature`, `$params`, `$status`, `$title`, `$traceId`, and the paging slots of each kind. `meta` fields say who fills each one (`fill`: `now`, `traceId`, `degraded`, a `principal.<field>` source, or `handler`). The IR keeps the unwrapped data and a reference to the format, so nothing restates the shape (FR-42).

## Departures from brief 5.3

| Sketch | Final | Reason |
|---|---|---|
| `api: { name, version, maturity }` only | adds `kind`, `role`, `caller`, `compat`, `documents` | FR-8, FR-13, FR-34 need them, and they are api facts |
| resources and routes in two maps at the top | one `routes` map per node; the node says its kind (`kind` or `method`) | two maps allowed the same name twice; the kind is already stated |
| top-level `resources` under an implicit surface | each surface holds its tree | several surfaces per api, each with its prefix, identity and documents |
| `prefix: /v1` | `prefix: /v{version}`, literal version refused | the version is one fact, held on the api (FR-2) |
| `path: /health` | relative `path`, no leading slash, default from the node name | paths mirror the tree; a leading slash suggested an absolute path that the prefix then changed |
| children of a `single` mixed with its settings | children under `routes` | a child named like a setting (`cache`) was ambiguous |
| `collection:` and `member:` holding children | they are nodes: settings plus `routes` | settings per scope (a scope id read from the member path) |
| `ops` plus `overrides` | `ops` as a list or a mapping of op settings | one place per op; no override for an op that is not listed |
| `create` input defaults | `create` and `update` require `input` | the item schema holds fields a client never sends |
| `requires: [{ roles: {...} }]` | `{ right: roles, params: {...} }` or `{ rule: ... }` | rights and rules are two catalogues (A18); a subject must not mix with params |
| `on: pathParam` in rule params | `subject` with a value-source grammar | one grammar for every value read from the request |
| `throttles:` | `buckets:` plus a rule with `bucket: true` | the bucket is what is counted; throttling is the rule (FR-41) |
| `identities.*.schemes.write: [session+csrf]` | `csrf` on the cookie scheme | CSRF is derived from the scheme, stated once (FR-27) |
| identity scheme names as strings | typed `schemes` catalogue | schemes are checked and emitted (FR-27) |
| no rights, scopes, signed identities | `rights`, `scopes`, `kind: signed` | A5, A18 to A25 |
| `access: { public }`, implicit optional auth | `public`, `optionalAuth`, `refusedAsAnonymous`, each with a reason | the sketch's `optionalAuth` bundled two behaviours that Arthome keeps apart |
| `idempotent: true` on a GET, `idempotent: { exempt }` | `idempotency: { exempt }` only | a GET is safe by its method; one name for the convention and the exemption |
| `errors` with fixed derived codes (`api.schema_invalid`) | derivation slots mapped by the conventions | the core imposes no error code (A20, A30) |
| `nature` open | closed set of three, packs map extra natures onto them | clients keep one retry rule (FR-6) |
| `enums: { Role: [owner, editor] }` | `{ values, source or reason, fallback }` | FR-29: source, local reason, fallback |
| `examples: { 200: ... }` | named examples with `status` or `request` | examples are named (checklist volume) and may target the request |
| implicit envelopes | `conventions.format`, default bare plus problem+json | A30 |
| `$ref: ./schemas/task.yaml` only | also names (`Task`) and plain strings in schema positions | readability; the IR is the same |
| `cache: { freshness, etag }` | adds `anonymous` and `vary` | FR-33 caller kinds |
| no workspace | `workspace.yaml` | several apis compile together for `relays` (FR-8) |

## Worked example: the reference tasks api

A workspace of two apis: a surface api with a tenant-scoped collection under rights, a single owned by the caller, a signed webhook surface, and a service api whose route relays a public operation. Schemas are kept short; their language is ADR 0003.

```yaml
# workspace.yaml
workspace:
  apis:
    tasks: ./tasks/api.yaml
    tasksService: ./tasks-service/api.yaml
```

```yaml
# shared/base.yaml
schemes:
  sessionCookie: { kind: cookie, name: __Host-session, csrf: csrfToken }
  csrfToken: { kind: header, name: X-Csrf-Token }
  bearer: { kind: bearer }
  internalToken: { kind: bearer, format: jwt }
  stripeSignature:
    kind: signature
    header: Stripe-Signature
    format: 't={ts},v1={sig}'
    algorithm: hmac-sha256
    payload: '{ts}.{rawBody}'
    encoding: hex
    tolerance: 5m
    key: { value: stripe }

identities:
  user:
    schemes: { read: [sessionCookie, bearer], write: [sessionCookie, bearer] }
    principal: UserPrincipal
  service:
    schemes: { read: [internalToken] }
    principal: ServicePrincipal
    headers:
      deadline: { name: X-Deadline, in: request, for: all, required: true, semantic: deadline }
      trace: { name: traceparent, in: request, for: all, semantic: traceContext }
      actorSurface:
        name: X-Actor-Surface
        in: request
        for: writes
        required: true
        semantic: actorSurface
        schema: { enum: Surface }
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

buckets:
  write: { key: [principal.userId], limit: 60, window: 1m }

errors:
  api.unauthenticated: { status: 401, nature: refused }
  api.forbidden: { status: 403, nature: refused }
  api.csrf_invalid: { status: 403, nature: refused }
  api.sort_key_forbidden: { status: 403, nature: refused }
  api.not_found: { status: 404, nature: refused }
  api.schema_invalid:
    status: 400
    nature: refused
    params: { issues: Issues }
    example: { issues: [{ pointer: /title, rule: minLength }] }
  api.payload_too_large: { status: 413, nature: refused }
  api.unsupported_media_type: { status: 415, nature: refused }
  api.idempotency_key_reused: { status: 409, nature: refused }
  api.idempotency_in_progress: { status: 409, nature: unavailable }
  api.rate_limited:
    status: 429
    nature: unavailable
    params: { retryAfterMs: { type: integer, minimum: 0 } }
    example: { retryAfterMs: 1500 }
  api.internal: { status: 500, nature: failed }
  api.deadline_exceeded: { status: 504, nature: unavailable }
  state.conflict: { status: 409, nature: refused }

conventions:
  paging: { default: cursor, maxLimit: 100 }
  idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetime: 24h }
  bodyLimit: 1MiB
  batch: { maxIds: 200, bodyLimit: 2MiB }
  cache: { families: { minute: 60s, hour: 3600s } }
  restrictedInput: reject
  errors:
    every: [api.internal]
    derived:
      unauthenticated: api.unauthenticated
      csrfInvalid: api.csrf_invalid
      forbidden: api.forbidden
      sortKeyForbidden: api.sort_key_forbidden
      notFound: api.not_found
      schemaInvalid: api.schema_invalid
      payloadTooLarge: api.payload_too_large
      unsupportedMediaType: api.unsupported_media_type
      stateConflict: state.conflict
      idempotencyKeyReused: api.idempotency_key_reused
      idempotencyInProgress: api.idempotency_in_progress
      rateLimited: api.rate_limited
      undeclaredStatus: api.internal
      deadlineExceeded: api.deadline_exceeded

enums:
  Role: { values: [owner, editor, viewer], reason: Roles are local to this product. }
  TaskState: { values: [open, done, archived], reason: Task states belong to this api. }
  Surface: { values: [app, studio], reason: The product's entry points. }
  Service: { values: [catalog, ticketing], reason: The product's internal services. }

schemas:
  include: ./schemas.yaml
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
```

`tasks/schemas.yaml` (not shown) declares the api's own schemas in the same way: `Health`, `Channel`, `CreateTask`, `UpdateTask`, `ArchiveTask` (holding `expectedVersion`), `Preferences`, `UpdatePreferences`, `DraftId`, `Draft`, `PaymentEvent`, `TaskQuery` and `TaskSearchResult`.

```yaml
# tasks/api.yaml
api:
  name: tasks
  version: 1
  kind: surface
  maturity: provisional
  summary: Tasks shared inside channels.
  compat: { policy: additive-only }
  documents:
    public: { surfaces: [app], internal: exclude }
    full: {}
extends: ../shared/base.yaml

schemas:
  include: ./schemas.yaml

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
                  sortable: [createdAt, effort]
                  filteredBy: tasks.read
                get: {}
                create:
                  input: CreateTask
                  requires:
                    - { rule: throttle, bucket: write }
                    - { right: roles, params: { allowed: [owner, editor] } }
                update:
                  input: UpdateTask
                  requires: [{ right: tasks.update }]
                batch: { maxIds: 200 }
              collection:
                routes:
                  search: { include: ./routes/tasks/search.yaml }
              member:
                routes:
                  assign:
                    method: post
                    requires: [{ right: roles, params: { allowed: [owner, editor] } }]
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
extends: ../shared/base.yaml

surfaces:
  internal:
    prefix: /internal/v{version}
    requires: [{ right: callerService, params: { allowed: [catalog] } }]
    errors: [api.not_found, api.forbidden]
    routes:
      channels:
        kind: collection
        id: { channelId: ChannelId }
        member:
          routes:
            tasks:
              kind: collection
              id: { taskId: TaskId }
              item: Task
              ops:
                get: { relays: tasks.getTask }
```

What the example shows, by route:

- `listTasks` (`GET /v1/channels/{channelId}/tasks`): identity `user` from the surface, scope `channel` from the member path of `channels`, cursor paging capped at 50, the restricted sort key `effort` (it inherits `tasks.seeEffort` from `Task.effort`), `filteredBy`.
- `createTask`: `throttle` then `roles` in that order, a body, an idempotency key from the conventions, CSRF from `sessionCookie` on a write.
- `updateTask`: `tasks.update` with the subject defaulting to `path.taskId`, the version read from `body.expectedVersion` and compared to `Task.version`, 409 `state.conflict`.
- `archiveTask`: a member action that opts into the version, kept out of the `public` document.
- `searchTasks`: an included route, idempotency exempt with its reason, a 300 ms budget, a named example.
- `getPreferences` and `updatePreferences`: a single owned by the caller, conditional GET; `deleteDraft` answers 200 with the deleted record.
- `payments` (`POST /v1/hooks/payments`): the signed `stripe` identity, raw body, no CSRF and no idempotency key, 204.
- `getTask` in `tasksService` (`GET /internal/v1/channels/{channelId}/tasks/{taskId}`): the service identity with its deadline, trace and actor-surface headers, `callerService` allowing `catalog`, and a relay whose superset check runs against `tasks.getTask`.

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
  access:
    optionalAuth: "Anyone may end their session."
    refusedAsAnonymous: "Signing out must succeed with an expired session."
  csrfExempt: "A forged sign-out harms no one."
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
  maturity: { level: experimental, reason: "Kept only for old clients." }
  output: Task
getDateDetail:
  method: get
  degradable: [viewerProgress]
  output: DateDetail
listInvoices:
  method: get
  paging: { pages: { maxLimit: 100 } }
  output: Invoice
listChanges:
  method: get
  paging: { changesSince: { token: opaque } }
  output: Change
```

## Consequences

- Phase 1 writes the authoring JSON Schema from sections 1 to 13 of this ADR; a keyword not listed here is refused by it, and the grammar snapshot test (SM-6) fails when a core keyword is added without an ADR reference.
- The loader implements sections 1 to 4 (composition, the byte-identity rule, pitfalls); the compiler passes implement sections 5 to 13 as ADR 0006 assigns them.
- Contracts carry no house convention: error codes, header names, right names and wire formats all come from the base or from packs. A contract without them fails with a diagnostic naming the missing slot or key, which is the price of A20, A25 and A30.
- The grammar has three shorthands only: a string for a schema reference, `ops` as a list, and `paging` as a kind name. Each yields the same IR as its long form.
- An inherited requirement cannot be removed below; a contract that needs it must restructure its tree. Revisit only with a consumer that cannot.
- Not modelled until a consumer needs it: `If-Match`, media types other than JSON (and the raw body of a signed identity), a base extending a base, shorthands beyond `ops`.

## Traceability

- FRs: FR-1, FR-2, FR-4, FR-5, FR-6, FR-7, FR-8, FR-9 (byte identity, modeline), FR-10 (extension keys, pack keywords), FR-13, FR-20 (keywords), FR-22, FR-23 (sort keys, filteredBy), FR-24, FR-27, FR-28, FR-29 (catalogue), FR-30, FR-31, FR-32, FR-33, FR-34, FR-41, FR-42.
- CHK items enabled: CHK-004 to CHK-020, CHK-021 to CHK-023, CHK-027 to CHK-046, CHK-048, CHK-050 to CHK-058, CHK-073, CHK-086, CHK-087, CHK-089, CHK-090, CHK-092 to CHK-095, CHK-100.

## Self-check: scenarios and keywords

Every FEAT-001 scenario that uses contract syntax, and the keywords it needs. Scenarios about targets, distribution or CI only (SCN-015, SCN-017, SCN-020 to SCN-025, SCN-027, SCN-028, SCN-049, SCN-052 to SCN-061, SCN-074, SCN-075, SCN-089 to SCN-095, SCN-098, SCN-099) use no syntax beyond what their fixture contract borrows from the rows below. SCN-072 (framework route allow-list) is consumer configuration, ADR 0011 and 0012.

| Scenario | Keywords (section) |
|---|---|
| SCN-001 | `include`, `routes`, `collection`, the byte-identity rule (2, 6) |
| SCN-002 | refused pitfalls, `include` cycles (3) |
| SCN-003 | `kind: collection`, `id`, `item`, `concurrency.version`, `concurrency.field`, `ops`, `member`, `method` (6) |
| SCN-004 | `owner: caller`, `ops` (6) |
| SCN-005 | `enums`, `enum` in a schema (12, ADR 0003) |
| SCN-006 | `examples`, `$file` (12, 2); refused keyword `if` (ADR 0003) |
| SCN-007 | `access.public`, `optionalAuth`, `csrfExempt`, `idempotency.exempt`, `lint.allow`, `maturity.reason`, enum `reason`, right `guest` (9 to 12) |
| SCN-008 | `schemes` with `csrf`, `identities.schemes.write`, `csrfExempt` (9) |
| SCN-009 | `identity`, `principal.requires`, `scopes`, `requires` (rule and right), `input`, `bindings` (9) |
| SCN-010 | `bindings` with body and path sources (9) |
| SCN-011 | `errors` registry and attachment with `{ code, example }`, `conventions.errors.every` (11) |
| SCN-012 | `conventions.paging.default`, `paging.cursor.maxLimit`, `sortable`, `restrictedTo` (10, ADR 0003) |
| SCN-013 | `cache.freshness`, `cache.etag`, `conventions.cache.families` (10, 13) |
| SCN-014 | `workspace.apis`, `api.kind: service`, `relays`, `workspace.imports` (1, 5, 7) |
| SCN-016 | `extensions`, `x-<prefix>-<key>` (12) |
| SCN-018 | `lint.allow`, `maturity`; `sensitive` (12, 10, ADR 0003) |
| SCN-019 | `api.compat.policy` (5) |
| SCN-026 | `schemes` of `kind: signature` (`header`, `format`, `algorithm`, `payload`, `encoding`, `tolerance`, `key`), `identities` of `kind: signed` (9) |
| SCN-029 | `extends`, duplicate definitions (2) |
| SCN-030 | `$ref` to a file, `include` of a schema (2) |
| SCN-031 | `concurrency.version: query.<p>`, `concurrency: inherit`, `If-Match` refused (6, 4) |
| SCN-032 | `api.version`, `surfaces.<s>.prefix` with `{version}` (5, 6) |
| SCN-033 | `input` inline, derived names; `oneOf`, `discriminator` (7, ADR 0003, ADR 0007) |
| SCN-034 | `principal.requires` (9) |
| SCN-035 | `identity` inheritance, `routes` (8, 6) |
| SCN-036 | `access.public`, `requires` with `bucket`, `buckets` (9) |
| SCN-037 | `errors` (`status`, `nature`, `params`, `example`), `natures` (11) |
| SCN-038 | `responses` with several 2xx and `headers` (7) |
| SCN-039 | `responses` 202 with `Location`, `Retry-After` (7) |
| SCN-040 | `ops.delete` with `output` (6) |
| SCN-041 | `conventions.bodyLimit`, `bodyLimit`, `conventions.batch` (13, 10) |
| SCN-042 | `conventions.idempotency`, `idempotency.exempt` (13, 10) |
| SCN-043 | `budget` (10) |
| SCN-044 | `api.documents` with `internal: exclude`, `internal: true` (5, 10) |
| SCN-045 | `api.caller.right`, `rights.callerService.params` (5, 9) |
| SCN-046 | `# yaml-language-server` modeline (3) |
| SCN-047 | `packs`, pack file keys (1, 2) |
| SCN-048 | `formats` (`success`, `meta.fill`, `error`), `conventions.format`, `ops.batch` (13, 6) |
| SCN-050 | `api.maturity`, `api.compat` (5) |
| SCN-051 | `deprecated.sunset`, `deprecated.successor` (10) |
| SCN-054 | `sensitive` (ADR 0003) |
| SCN-062 | `rights` (`params`, `subject.scope`, `subject.resource`, `subject.id`), default subject (9) |
| SCN-063 | `rights.guest`, `access.public` (9) |
| SCN-064 | `extensions` with `at: [right]`, `x-<prefix>-<key>` on a right (12, 9) |
| SCN-065 | `restrictedTo` (ADR 0003), `access.public` (9) |
| SCN-066 | `conventions.restrictedInput`, per-field override (13, ADR 0003) |
| SCN-067 | `sortable` with `{ key, right }` (10) |
| SCN-068 | `filteredBy` (10) |
| SCN-069 | `scopes` catalogue with `within`, `scopes` on a node with `subdomain` and `path` sources (9, 4) |
| SCN-070 | `scopes` with `resolver` (9) |
| SCN-071 | `rights` (no syntax beyond SCN-062) |
| SCN-073 | `packs` with the CRUD rights pack, `ops` (2, 6) |
| SCN-076 | `identities.principal.variants`, `schemes.optionalRead` (9) |
| SCN-077 | `schemes` (`kind`, `name`, `csrf`), `identities.schemes` (9) |
| SCN-078 | identity `headers` with `deadline`, `traceContext`, `actorSurface`, `budget` (9, 10) |
| SCN-079 | identity header `versionToken` (`from`, `response`, `request`, `stale`) (9) |
| SCN-080 | `enums` (`values`, `source`, `reason`, `fallback`), narrowing (12, ADR 0003), `conventions.outputEnums` (13) |
| SCN-081 | `query` fields map with `?` and an object field (7, 4) |
| SCN-082 | `paging.changesSince.token` (10) |
| SCN-083 | `paging.pages.maxLimit` (10) |
| SCN-084 | `ops.batch.maxIds`, `conventions.batch` (6, 13) |
| SCN-085 | `degradable`, `conventions.degradedHeader` or a format `meta` slot (10, 13) |
| SCN-086 | `access.optionalAuth`, `cache.anonymous`, `cache.vary`, `sensitive` (9, 10) |
| SCN-087 | `services`, `upstream`, `maturity.level`, `maturity.reason`, `api.role: gateway` (10, 5) |
| SCN-088 | `summary`, `description` with `$file` (12, 2) |
| SCN-096 | `buckets` (`key`, `limit`, `window`), `rules.throttle.bucket`, `conventions.rateLimit` (9, 13) |
| SCN-097 | `rules.recentAuth.proof`, `params` (9) |
| SCN-100 | `packs`, `formats`, `conventions.format` (2, 13) |

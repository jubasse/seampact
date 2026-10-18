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

`prefix` is the surface's leading path. `{version}` is replaced by `api.version`. A prefix with no `{version}` gets `/v{version}` in front of it. A literal version segment such as `/v1` is then refused, with the mismatch stated when it differs from `api.version` (FR-2, SCN-032); the version is held once, on the api.

A path in the contract is the path a client sends after the api's base URL. Where a framework adds its own prefix (a NestJS global prefix, Laravel's `/api` route group, a servlet context path, API Platform's route prefix), that prefix is deployment, not contract: the server target's `mount` in the app config states it and the boot check compares it with the framework's (ADR 0011, ADR 0012), a client takes its base URL at run time, and a document may list `servers` through its app-config options. A contract therefore never writes `/api` into a prefix to match one server.

The path version is a default, not a rule (A33). `conventions.pathVersion` is `prefix` (the default) or `none`, so a pack can make "no path version" a house default, and `pathVersion` on one surface overrides it. With `none` the prefix is used exactly as written and may not hold `{version}`. That serves an api versioned by a header, a media type or a date (declared with its own headers or formats) and a webhook path a third party fixes:

```yaml
# tasks/api.yaml (excerpt)
surfaces:
  stripeHooks:
    prefix: /stripe
    pathVersion: none                 # Stripe calls the URL configured in its dashboard
    identity: stripe
```

Every node is a mapping of settings plus its children. There are four kinds of node:

| Node | Marked by | Children |
|---|---|---|
| route | `method` | none |
| relay route | `relays`, in a surface root's `routes` only (section 7) | none |
| collection | `kind: collection` | `ops`, `collection`, `member` |
| single | `kind: single` | `ops`, `routes` |

A surface root, a single, and the `collection` and `member` scopes of a collection hold their children under `routes`, a mapping from child name to node. The child name is written in the parent file even when its content is included (`search: { $include: ./routes/tasks/search.yaml }`), so every route stays discoverable from its parent.

A node's path segment is its name, converted by `conventions.pathCase` (`kebab`, the default, `camel` or `snake`). `path` replaces the segment: it is relative to the parent, has no leading slash, may be empty or hold several segments, and may hold `{param}` placeholders declared in `pathParams`.

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
      search: { $include: ./routes/tasks/search.yaml }
  member:
    scopes: { task: path.taskId }
    routes:
      assign: { method: post, input: AssignTask, output: Task }
```

| Key | On | Meaning |
|---|---|---|
| `id` | collection | a fields map with one entry: the member id path parameter and its schema |
| `idProperty` | collection | the item property that holds the member id, when its name differs from the path parameter (`id` for `taskId`); default the parameter's name |
| `singular` | collection | the noun of member operation ids, instead of the one derived from `id` (below) |
| `resourceType` | collection, single | the value of the `$collection` slot (a JSON:API `type`, a HAL `_embedded` key), when it differs from the node name: `blog-posts` |
| `item` | collection, single | the schema of one record; a collection without `ops` that need it may omit it, and a single with neither `item` nor `ops` only groups its `routes` (`me` in the worked example) |
| `owner` | collection, single | `caller`: see write semantics |
| `concurrency` | collection, single | `{ version: <body or query source>, field: <item field> }`; on a member route, `concurrency: inherit` |
| `ops` | collection, single | the shorthand routes; see below |
| `collection` | collection | a node for the collection scope (`/tasks`): settings plus `routes` |
| `member` | collection | a node for the member scope (`/tasks/{taskId}`): settings plus `routes` |
| `routes` | single, surface, `collection`, `member` | the named children |

An `item`, an entry of `id` and a response header take a schema name or an inline schema that is not an object, a map or a union: no operation names these positions, so an inline object there would have no derived name (ADR 0007 section 3), and the compiler refuses it; declare it under `schemas` and name it.

Settings written on the collection node apply to all its routes; settings written in `collection` or `member` apply to that scope only. The routes `list`, `create` and `batch` belong to the `collection` scope, and `get`, `update` and `delete` to the `member` scope: each inherits that scope's settings, as if written under `.../collection` or `.../member`, while its origin is the `ops` entry that writes it (`.../tasks/ops/get` in a mapping, `.../tasks/ops/1` for `get` in the list `[list, get]` above), a position the side table locates. That is how a scope id read from the member path (`path.channelId`) applies to `getChannel` and every member route, and not to the list. A route's `path` is relative to its scope's path (`/tasks` for `collection`, `/tasks/{taskId}` for `member`).

A single with neither `item` nor `ops` is a group: settings and `routes`, nothing of its own. With a `path` of several segments, a group reaches a nested resource without the empty collections in between, each of which costs a `kind`, an `id`, a `member` and a `routes` level:

```yaml
# tasks/api.yaml (excerpt: under a surface's routes)
projectTasks:
  kind: single
  path: 'orgs/{orgId}/projects/{projectId}'
  pathParams: { orgId: OrgId, projectId: ProjectId }
  scopes: { org: path.orgId, project: path.projectId }
  routes:
    tasks: { $include: ./routes/tasks.yaml }
```

A group's path parameters are not member ids, so they derive no `notFound` (ADR 0006 section 5): a scope that reads them answers a missing one, as here, or a code attached on the group does. A route written directly in the group's `routes` takes the group's name in its operation id, while a collection below it names its own (`listTasks`). The two-collection form stays the one to use when the parents have operations of their own.

#### The `ops` shorthand

`ops` expands to ordinary routes; the IR holds only routes. It is either a list of op names or a mapping from op name to settings for that op; the list `[get, update]` is the mapping `{ get: {}, update: {} }`.

| Op | On | Method and path | Operation id | Input | Success |
|---|---|---|---|---|---|
| `list` | collection | `GET /tasks` | `list` + plural (`listTasks`) | the paging style's request roles | `200`, a page of `item` (section 14) |
| `get` | collection, single | `GET /tasks/{taskId}`, `GET /me/preferences` | `get` + singular (`getTask`, `getPreferences`) | none | `200`, `item` |
| `create` | collection | `POST /tasks` | `create` + singular | required `input` | `201`, `item` |
| `update` | collection, single | `PATCH /tasks/{taskId}` | `update` + singular | required `input` | `200`, `item` |
| `delete` | collection, single | `DELETE /tasks/{taskId}` | `delete` + singular | none (a versioned delete reads its version from the query or a header) | `204`, or `200` with `output` (SCN-040) |
| `batch` | collection | `POST /tasks/batch` | `get` + plural + `Batch` (`getTasksBatch`) | `{ ids }`, at most `maxIds`, or a declared `input` | `200`, a table of `item` keyed by id |

The plural is the collection's name; the singular is the collection's `singular` when set, otherwise the id parameter's name without its trailing `Id` (`taskId` gives `task`), or the whole parameter name when it has no such suffix. `singular` keeps the id named like the item's property when the noun differs: `members` with `id: { userId: UserId }` and `singular: member` gives `listMembers` and `getMember`, and `userId` still matches `Member.userId` for the `$id` slots and the batch table. For a single, the noun is the single's name. The methods, paths, operation ids and statuses above are defaults (A36). `conventions.ops` changes them for the whole api (`{ update: { method: put }, create: { status: 200 }, batch: { path: lookup } }`), and `conventions.operationIds: { order, case }` changes how every operation id is derived: `order` is `verbNoun` (the default, `listTasks`) or `nounVerb` (`tasksList`), `case` is `camel` (the default) or `snake` (`tasks_list`). The id so derived is the operation's id everywhere: in the IR, in OpenAPI, in `relays`, `deprecated.successor` and `seampact explain` (ADR 0007 section 3). An op mapping takes every route key of section 7 except `relays`, every inherited setting of section 8, and `maxIds` for `batch`, so any op may override its method, path, operation id, input, output and responses. `create` and `update` have no default input, because the item schema holds fields a client never sends; the missing input is a compile error naming the op. No other shorthand exists until a consumer needs one (lesson 5).

A `batch` op is a safe read sent as POST: the IR marks it safe, so CSRF, idempotency and cache derivations treat it as a read. Its `maxIds`, body limit and budget default to `conventions.batch` (FR-32, SCN-084); a `bodyLimit` or `budget` written on the op or on a node above it wins over that default, as any inherited setting does.

With `conventions.operationIds: { order: nounVerb }` the batch op's id reads `tasksBatchGet` where the default order gives `getTasksBatch`; `ops: [list, batch]` then yields `tasksList` and `tasksBatchGet`:

```yaml
# tasks/api.yaml (excerpt)
conventions:
  operationIds: { order: nounVerb }
  batch: { maxIds: 200 }
```

Operation ids of other routes: a route under `member` is its name plus the singular (`assign` gives `assignTask`); under `collection`, its name plus the plural (`search` gives `searchTasks`); under a single, its name plus the single's name; under a surface root, its name. `operationId` replaces the derived id. Operation ids are unique across the api; a clash is a compile error naming both routes. Names are stored as word segments (ADR 0007). A derived id reads as a verb and a noun when the route name is a verb (`assign`, `search`, `archive`); a noun route gives an awkward one (`activity` under a workspace member gives `activityWorkspace`, a hook named `github` gives `github`), so name routes with verbs, or set `operationId`.

#### Write semantics

Kept from the first sketch (FR-2):

- `owner: caller`: the caller owns the records. On a collection, another caller's id answers 404 (derived), with no version and no 409; on a single, nothing is derived (SCN-004). The boundary cannot know who owns a record, so the handler (or the optional record loader of ADR 0012) answers it through its typed error result for the `notFound` role (ADR 0012), no hook is added, and the generated test helper checks the declared 404.
- Otherwise a write may be versioned: `concurrency: { version: body.expectedVersion, field: version }`. `version` is where the client sends the version it read: a body field, a query parameter, or a request header (`header.If-Match` reads it as a strong entity tag, `"7"`); `field` is the item property it is compared with. `update` and `delete` inherit it; a member route only with `concurrency: inherit` (SCN-003, SCN-031), and so does a single's own route; `concurrency: inherit` on any other route, or under a node without `concurrency`, is a compile error. The compiler adds the version parameter itself, typed like `field`, after the authored fields: to the body input for a body source, to the query or headers otherwise. No input restates it, and an input that declares it is a compile error ("remove it; `concurrency` adds it"); an item schema without `field` is a compile error naming the field. A route without a body never carries the version in one (A33): on a `delete` without `input`, a body source becomes the query parameter of the same name (`body.expectedVersion` gives `query.expectedVersion` on `deleteTask`), and a query or header source stays as it is. A stale write derives `409` from the `stateConflict` role for a body or query version. With `header.If-Match`, HTTP's own answers apply (RFC 9110, RFC 6585): a stale tag derives `412` from the `preconditionFailed` role, and a write without the header `428` from the `preconditionRequired` role; every response carrying the item writes its `ETag` from `field`, and `cache.etag` on such a route uses that tag. Each role stays renamable (section 11).
- DELETE when the record disappears; an action (`POST .../archive`) when it stays with a new state.

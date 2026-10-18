### 11. Errors and natures

```yaml
# shared/base.yaml (excerpt)
errors:
  api.forbidden:
    status: 403
    nature: refused
    title: The caller may not do this.
    params: { pointer?: { type: string } }
  api.rate_limited:
    status: 429
    nature: unavailable
    params: { retryAfterMs: { type: integer, minimum: 0 } }
    example: { retryAfterMs: 1500 }
```

A declaration defines a code once: `status` (400 to 599), `nature`, `family`, `params` (a fields map or a schema name), `example` (the params), `title`, `description` (FR-6, SCN-037). `nature` may be left out: it is then `unavailable` for 408, 425, 429, 502, 503 and 504, `refused` for every other 4xx and `failed` for every other 5xx. `family` groups codes in docs and clients; it defaults to the code up to its first dot (section 4).

Codes are declared at every level of the tree ([A35](../decisions.md#a35)): in the `errors` catalogue (the api's global level, with its base and packs), or in `errors` on any node: a surface root, a collection, a single, a `collection` or `member` scope node, or a route. On a node, `errors` maps a code to one of:

- `{}`: attaches a code declared elsewhere;
- `{ example }`: attaches it and narrows its example to this subtree's case;
- a declaration (it holds `status`): declares the code and attaches it.

Each of the three may add `reach` and `for`, below.

```yaml
# tasks/api.yaml (excerpt: node settings of tasks)
errors:
  state.conflict: {}
  tasks.not_found: { status: 404, title: 'No such task in this channel.' }
  api.rate_limited: { example: { retryAfterMs: 30000 } }
member:
  errorRoles:
    notFound: tasks.not_found
  errors:
    tasks.locked:
      status: 423
      title: 'Another editor holds the task.'
      params: { lockedBy: UserId }
      reach: resource
      for: writes
```

A node's codes attach to the operations below it; children add codes or narrow an example, never remove one (section 8). How far "below" goes is the attachment's reach. `subtree`, the default (A35), attaches the code to every operation below the node, child resources included. `resource` stops at the resource boundary: the code reaches the node's own `ops` and the routes of its `collection`, `member` and `routes` maps, but no child node with `kind` (a nested collection or single) and nothing below one. `conventions.errors.reach` sets the api's default; `reach` on one attachment overrides it. `for` narrows an attachment to `reads` (the safe routes, a `batch` read included) or `writes` (every other route); `all` is the default, as for an identity header's `for` (section 9). Above, `tasks.locked`, attached on `member` for writes with `reach: resource`, reaches `updateTask` and `assignTask` but not `getTask`, nor the routes of a `comments` collection nested under a task, so each error union lists only what its route can answer. `conventions.errors.every` attaches codes to every operation. Codes are api-wide, whatever level declares them: a code declared on a node joins the api's registry and any other node may attach it by name. Declaring a code a second time with a different definition is a compile error naming both locations; re-attaching it, here or below, is how it is reused. Rights, rules, scopes and identities list the codes they may answer, attached with `derivedFrom` in the IR. The IR records, for each operation's code, the node it was attached at, and for each declaration where it was declared (ADR 0004).

A nature tells a client whether retrying can help. Three base natures drive every client's retry rule: `refused` (retrying the same request cannot succeed), `unavailable` (retrying later may succeed) and `failed` (the server failed). A contract or a pack may name its own natures in the `natures` catalogue, each mapped onto one base (A40):

```yaml
# shared/base.yaml (excerpt)
natures:
  throttled: { base: unavailable, summary: 'Too many requests; retry after the stated delay.' }
  conflict: { base: refused }
```

An error then states `nature: throttled`. The `$nature` slot writes the declared name, and a client takes its retry rule from the base of the code's declaration, which the generated client holds from the IR, never from the wire; every client therefore keeps one retry rule however many natures a contract names. A nature named like a base, or mapped onto anything but a base, is a compile error naming the allowed values (SCN-037).

#### Error roles

Derived errors answer roles, never fixed codes: `unauthenticated` (401), `csrfInvalid`, `forbidden`, `sortKeyForbidden` (403), `notFound` (404), `schemaInvalid` (400), `payloadTooLarge` (413), `unsupportedMediaType` (415), `stateConflict`, `idempotencyInProgress` (409), `gone` (410), `preconditionFailed` (412), `idempotencyKeyReused` (422), `preconditionRequired` (428), `rateLimited` (429), `undeclaredStatus` (500), `upstreamUnavailable` (502), `serviceUnavailable` (503), `upstreamTimeout`, `deadlineExceeded` (504). The derivation table that uses them is ADR 0006 section 5.

Every role has a default code in the core (`api.schema_invalid`, `api.forbidden` and the others of ADR 0006 section 6), registered when used and rendered through the api's format, so a contract with no pack compiles (A34). A role is renamed for the whole api by `conventions.errors.derived`, or for a subtree by `errorRoles` on any node, the nearest binding winning (A35). Above, every member route of `tasks` answers `tasks.not_found` for the `notFound` role: a route below a collection's `member` scope derives it for an id the client chose and no scope reads (ADR 0006 section 5), and the handler answers it, as any code its operation lists, through a typed error result (ADR 0012). The binding sits on `member`, not on the collection node: `listTasks` and `createTask` hold only parent ids in their path, and a binding there would rename the 404 of a missing parent too. A binding is a code, or `{ code, params }`:

```yaml
# shared/base.yaml (excerpt)
conventions:
  errors:
    derived:
      schemaInvalid:
        code: api.schema_invalid
        params: { issues: { $each: $issues, $as: { pointer: $item.pointer, rule: $item.rule } } }
      forbidden: { code: api.forbidden, params: { pointer: $pointer } }
```

The boundary produces data for each role (the validation issues, the restricted field's pointer, the sort key, the body limit, the retry delay; ADR 0006 section 6 lists them). Without `params`, each param of the bound code takes the datum of the same name, in the order of the code's params schema; the compiler writes that by-name template into the IR and checks that every required param gets a value. `params` is a template (section 13) over the role's data, with these exceptions: a slot without a value has none, and a member without a value is omitted whatever the format's `absent`; a text template with a part without a value has none, and a number or boolean part is its JSON text; an array item without a value is dropped; `$each` over an empty list gives `[]`, over a slot without a value none; `$merge` of a slot without a value adds no member; an object left with no member has no value, except the top-level params object, kept as `{}`. An `$each` inside another `$each`'s `$as` is a compile error: role data are flat, so the params stay linear in them. A bound code must be registered, and its params must receive every datum the role marks required, by name or through `params`; otherwise the binding is a compile error naming the role, the datum and the code.

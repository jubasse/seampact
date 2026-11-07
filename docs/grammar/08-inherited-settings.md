### 8. Inherited settings

Every node may set the settings below; its descendants inherit them, and the IR records the node each one came from (FR-2, SCN-003, SCN-035). No other state is global.

| Setting | Merge rule down the tree |
|---|---|
| `identity`, `access` | the nearest wins for each; a node setting `identity` without `access` makes the identity required below it (section 9) |
| `requires` | appended: requirements derived by pack entries first (packs in application order, entries in written order), then the ancestors' from the root down, then the node's own; the same right or rule twice with equal params is an error, except that a derived requirement equal to a written one is dropped and the written one stays |
| `scopes` | added; entering a scope twice is an error |
| `principal.requires` | union |
| `bindings` | added; one key bound to two different values is an error |
| `errors` | union, each attachment within its `reach` and `for` (section 11); a code declared on a node joins the api registry; an example narrowed by the nearest node wins |
| `errorRoles` | per role, the nearest wins, over `conventions.errors.derived` |
| `tags` | union |
| `headers`, `query` | added; one name declared twice is an error. `query` reaches safe routes only: a write route below a node's `query` does not get it |
| `upstream`, `maturity`, `internal`, `deprecated`, `budget`, `bodyLimit`, `cache`, `csrf`, `idempotency`, `format`, `unknownQuery`, extension keys | the nearest wins |

`owner`, `concurrency`, `ops`, `inputMedia`, `id`, `idProperty`, `singular`, `resourceType`, `item`, `path`, `pathParams`, `paging`, `sortable`, `filteredBy`, `degradable`, `relays`, `examples` and docs are not inherited (`lint.allow` is, section 12): each applies to the node or element it is written on. Three inherited settings have limits: `deprecated.successor` is written on a route only, since one successor cannot serve several operations; `cache` applies to the GET routes below it and is refused on a non-GET route; a stated `maturity`, written on the route or inherited, wins over the one derived from `upstream`. An inherited requirement cannot be removed below; a route that needs fewer requirements belongs elsewhere in the tree. This keeps every requirement of a route visible in its ancestry. Since the tree is the URL, "elsewhere" is a sibling group (section 6) whose multi-segment `path` reaches the same URL without the requiring node:

```yaml
# tasks/api.yaml (excerpt: under a surface's routes)
channels:
  kind: collection
  id: { channelId: ChannelId }
  member:
    requires: [channelEditor]          # every route below needs it
    routes:
      settings: { method: patch, input: ChannelSettings, output: Channel }
channelPreview:
  kind: single
  path: 'channels/{channelId}/preview'
  pathParams: { channelId: ChannelId }
  scopes: { channel: path.channelId }
  routes:
    get: { method: get, path: '', output: ChannelPreview }   # GET /v1/channels/{channelId}/preview, without channelEditor
```

Requirements stack, they are not refined: `{ right: projectAccess, params: { level: read } }` on a `member` scope plus `{ right: projectAccess, params: { level: admin } }` on one of its routes asks the decide hook twice, in that order, and the route runs only when both allow. Where the second call matters, write the requirement on each route rather than on the scope; a `requirements` entry (section 9) keeps that to one name per route.

Inheritance by position has one trap. When the last key of a block is written one level too far left, the file is still valid YAML and the key becomes a setting of the enclosing node, reaching every route below it; a dedent in the middle of a block is a parse error, so only a last key is at risk. For an exception, that silently widens it from one route to a subtree while its reason stays present. The lint rule `seampact/subtree-exception`, a warning that `compile --strict` fails, therefore reports every `access.public`, `access.optionalAuth`, `csrf.exempt`, `idempotency.exempt` and `unknownQuery: { ignore }` written on a node that is neither a route nor a surface root, naming the routes it reaches. An exception meant for a subtree keeps it with `lint.allow` and a reason (section 12). Unlike every other allow, an allow of `seampact/subtree-exception` applies to the node it is written on only and is not inherited, so allowing one deliberate subtree exception never silences a slip further down. A code attached one level too high is not an exception: it shows in `seampact explain` (section 16) and in the diff of the committed OpenAPI document, where each response lists its codes with the node that attached them (ADR 0004 section 12).

### 13. Conventions and wire formats

`conventions` holds the api-wide settings. Any layer may set them (section 2), usually a pack; a node never does, because a convention is one fact for the whole api. The table gives each key's default and, where there is none, when the key becomes required; a missing required key is a compile error naming the key, the route that needs it and the fix.

```yaml
# shared/base.yaml (excerpt)
conventions:
  format: bare
  pathCase: kebab
  paging: { default: cursor, maxLimit: 100 }
  idempotency: { header: Idempotency-Key, replayHeader: Idempotency-Replayed, lifetime: 24h, methods: [post] }
  bodyLimit: 1MiB
  batch: { maxIds: 200, bodyLimit: 2MiB, budget: 150ms }
  cache:
    families:
      minute: 60s
      five_minutes: { maxAge: 300s, sharedMaxAge: 600s, staleWhileRevalidate: 60s }
      revalidated: { maxAge: 0s, noCache: true }
  restrictedInput: reject
  outputEnums: enum
  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }
  errors:
    every: [api.internal]
    derived: { unauthenticated: api.unauthenticated, forbidden: api.forbidden }
```

| Key | Meaning | Default, or when required |
|---|---|---|
| `format` | the wire format (section 13) | `bare` (A30) |
| `pathCase` | how node names become path segments: `kebab`, `camel` or `snake` | `kebab` |
| `paging.default` | the paging style of a list without `paging` (section 14) | none: a list with neither is a compile error naming both fixes (A31) |
| `paging.maxLimit` | the largest `limit` a request may send | none: required when a list uses a style with a `limit` role and sets no `maxLimit` |
| `paging.defaultLimit` | the limit of a request that sends none, and the page size of a style without `limit` | `maxLimit`; required for a style without `limit` |
| `paging.overLimit` | `reject` (400) or `clamp` (served as `maxLimit`): a `limit` above `maxLimit` (section 14) | `reject` |
| `idempotency` | `{ header, replayHeader, lifetime, methods, required, enforce }`: enables the idempotency key on every non-safe route whose method `methods` lists and that is not exempt (FR-7, A34). `methods` lists `post`, `put`, `patch` and `delete`, all four by default, so a POST-only policy is `methods: [post]`. `required` is `true` by default: a request without the key answers 400 from the `schemaInvalid` role; with `false` it runs without replay protection. `enforce` is `boundary` (the default: the boundary fingerprints the request, stores the final response of every request that reached the handler, a success or an error the handler answered, and replays it; a refusal before the handler is not stored; a key reused with another request answers 422, one still running 409) or `none` (the key is declared, documented and passed to the handler, for an app whose gateway or library already handles replay) | unset: no key is derived, and an `idempotency.exempt` on a route the key does not reach is a compile error naming the unused reason |
| `bodyLimit` | the default request body limit | `1MiB` |
| `batch` | `{ maxIds, bodyLimit, budget }` for `batch` ops | `maxIds` required when a `batch` op sets none; `bodyLimit` from `bodyLimit`; no budget |
| `cache.families` | freshness families: a max-age (`60s`), or `{ maxAge, sharedMaxAge, staleWhileRevalidate, staleIfError, immutable, noCache, mustRevalidate }`, each key a `Cache-Control` directive in camel case (`noCache: true` writes `no-cache`, for a response always revalidated with its ETag) | empty: each family a `cache.freshness` names is required |
| `restrictedInput` | `reject` or `strip`: a restricted field sent without its right ([A21](../decisions.md#a21)); overridable per field (ADR 0003) | `reject` |
| `outputEnums` | `enum` or `open`: how the emitter writes an output enum (FR-29) | `enum` |
| `pathVersion` | `prefix` or `none`: whether every surface's path starts with `/v{version}` (section 6); a surface's `pathVersion` overrides it | `prefix` (A33) |
| `query` | `{ lists, objects, unknownKeys }`: how a query list and an object field travel, and whether an undeclared key is refused (section 7) | `{ lists: repeat, objects: explode, unknownKeys: refuse }` |
| `input.unknownKeys` | `refuse`, `{ ignore: "<reason>" }` or `{ keep: "<reason>" }`: the api's policy for unknown keys of body inputs; an `unknownKeys` on a schema use wins (ADR 0003 section 4) | `refuse` |
| `int64` | `string` or `number`: the wire form of an `int64` value (ADR 0003 section 8) | `string` |
| `deprecation` | `{ header, sunsetHeader, successorRel }`: the names of the deprecation headers (section 10) | `Deprecation`, `Sunset`, `successor-version` |
| `ops` | per op name, `{ method, path, status }`: the defaults of the `ops` table (section 6) | the table's values |
| `operationIds` | `{ order: verbNoun \| nounVerb, case: camel \| snake }`: how operation ids are derived (section 6) | `{ order: verbNoun, case: camel }` |
| `rateLimit` | `{ header, param, unit }`: the header written on a 429 from a bucket rule, carrying the denial's integer millisecond `param` in `unit` (`s`, rounded up, or `ms`) | unset: a 429 carries no retry header |
| `degradedHeader` | the header listing degraded parts | unset: required for a `degradable` route whose format has no `degraded` meta field |
| `urls` | `relative` or `absolute`: how the URL slots and roles are written (section 13) | `relative` |
| `rights.pattern` | a pattern every right name must also match (section 2) | unset: the core pattern only (A20) |
| `errors.pattern` | a pattern every error code must also match, the dotted `family.name` form for example (`'^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'`) | unset: the core pattern only (A36) |
| `errors.every` | codes attached to every operation (section 11) | empty |
| `errors.reach` | `subtree` or `resource`: how far a code attached on a node reaches (section 11) | `subtree` (A35) |
| `errors.derived` | role bindings (section 11) | the default codes of ADR 0006 section 6 (A34) |

The core imposes no wire format (A30). `format: bare`, the default, is itself written as format data below: every success body is the bare payload, and an error is an RFC 9457 `application/problem+json` body whose members are fixed in ADR 0006 section 7. `bare` has no paging style, because the core imposes no page shape either (A31, section 14). Every other format (a house envelope, JSON:API, HAL, JSON-LD and Hydra, Laravel resources and paginators, Spring Page and ProblemDetail) is declared in `formats`, usually by a convention pack, and selected with `conventions.format`; each target maps it onto its framework's own mechanism (FR-42, SCN-048, SCN-100).

#### Wire formats

```yaml
# packs/house.yaml (excerpt)
formats:
  acmeEnvelope:
    media: application/json
    success:
      item: { body: { data: $payload, meta: $meta } }
      table: { body: { data: $payload, meta: $meta } }
      list: { body: { data: $payload, meta: $meta } }
      page: { body: { data: $items, meta: $meta } }
    meta:
      servedAt: { fill: now }
      degraded: { fill: degraded }
    error:
      body: { error: { code: $code, nature: $nature, params: $params, traceId: $traceId } }
```

| Key | Meaning |
|---|---|
| `media` | the media type of success bodies; `application/json` by default |
| `absent` | what a slot with no value writes: `omit` (default) or `null` |
| `success.item`, `success.table`, `success.list`, `success.page` | one per response shape: `{ body, headers }`. `body` is a template, `$payload` by default (`$items` for `page`); `headers` maps a header name to a template. `item` is one record or any non-list body, `table` the id-keyed object of a `batch` read, `list` an unpaged list, `page` a paged list, whose paging style adds members to it or replaces its body (section 14) |
| `meta` | the meta fields, each `{ fill, schema }`: `fill` is `now`, `traceId`, `degraded`, a `principal.<field>` source, or `handler`; `handler` and `principal.<field>` then need `schema` |
| `error` | `{ media, body, headers }`; `media` defaults to the format's. A format without `error` uses the `bare` error. The body must write `$code`, as a member or inside a text template (`'https://errors.acme.com/${code}'`), so a client can tell the code; a format whose error writes no `$code` is a compile error naming the format |

A shape left out uses its default (`body: $payload`, or `$items` for a page, and no headers), so `bare` writes only its error.

#### Templates

A template describes a JSON value the boundary writes. The same language serves format shapes, paging styles (section 14) and error-role params (section 11).

| Written | Meaning |
|---|---|
| `$name` (the whole string) | a slot: the value the boundary fills, with its own JSON type |
| `$name.member` | a member of an object slot (`$item.taskId`, `$issue.pointer`) |
| `${name}` inside a longer string | the slot's value as text (`'/contexts/${resource}'`, `'${status}'`) |
| `$$` | a literal `$` (`$$ref` writes `$ref`) |
| a mapping | an object; each key is a member name, written literally |
| the key `$merge: <slot>` | spreads an object slot's members beside the others; a member defined twice is a compile error naming both |
| a key that is a name slot (`$collection`) | the member name is the slot's value |
| `{ $each: <slot>, $as: <template> }` | an array: `$as` applied to each element of an array slot; inside it, `$item` is the element |
| a sequence | an array of templates |
| any other scalar | a literal |

A member whose value is a slot with no value is omitted, or written `null` when `absent: null`; an object whose members are all omitted is omitted in turn, so `next: { href: $next }` disappears on the last page. `$merge` takes an object-typed slot only, and a payload that is not an object fails to compile under a format that merges it; `$each` takes an array-typed slot only. A table's id-keyed payload is an object; its members are ids, so no member clash is checked. Any other `$` in a string is a compile error; write `$$` for a literal `$`. A key that starts with `$` is a name slot or `$$…`; any other is a compile error. The name slots are the slots whose value is a text or a number (`$collection`, `$resource`, `$id`, `$status`, a URL or a cursor); an object, array or boolean slot names no member.

The slots are a closed set:

| Slot | Value | Where |
|---|---|---|
| `$payload` | what the handler returns: the item, the id-keyed table, or the array of an unpaged list | success shapes |
| `$meta` | the object of the format's `meta` fields; in `success.page`, joined by the `meta` members of the paging style (section 14) | success shapes, paging styles |
| `$items` | the page's records, as the handler returns them | `success.page`, paging styles |
| `$status` | the HTTP status | everywhere |
| `$self` | the URL of what the body describes: the member URL of a collection item (built from `$id`), the current page of a paged list, the request URL otherwise | everywhere |
| `$path` | the request path, without the query | everywhere |
| `$resource` | the item schema's `typeName` (ADR 0003 section 6), or its name (`Task`) | success shapes, paging styles |
| `$collection` | the collection's or single's `resourceType`, or its node name (`tasks`); also a member name | `table`, `list`, paging styles |
| `$id`, `$fields` | the record's id, and the record without its id member | `item` |
| `$item`, `$itemId`, `$itemFields`, `$itemSelf` | inside `$as`: the element, its id, the element without its id member, its member URL | `$as` |
| `$code`, `$nature`, `$title`, `$detail`, `$instance`, `$traceId`, `$params` | the error's code, nature, title (or code), optional text, optional occurrence reference, optional trace id, and its params object | `error` |
| `$<role>` | a paging response role (section 14) or an error-role datum (section 11) | paging styles, role params |

`$id`, `$fields`, `$itemId`, `$itemFields` and `$itemSelf` read the item property named by the collection's `idProperty`, or else named like its `id` parameter (`taskId`); a format that uses one on an operation whose item lacks that property fails to compile, naming the operation and the property. The batch table is keyed by the same property. The URL slots (`$self`, `$itemSelf` and the URL roles of section 14) are relative references by default; `conventions.urls: absolute` writes absolute URLs, built from the request's scheme and host as the framework's trusted-proxy settings report them, since the boundary cannot guess a public host behind a proxy. `bare` (format) is reserved: a declared `bare` replaces the default. The names `never` (cache family) and `none` (paging style) are reserved, and so are the portable format names in `scalars` (ADR 0003 section 8).

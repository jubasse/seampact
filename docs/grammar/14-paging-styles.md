### 14. Paging styles

Paging imposes no convention (A31). A paging style lists the semantic roles a list uses and maps each one to a location and a name of the contract's choosing: a query parameter or a request header for the request roles, a body member, a response header or an RFC 8288 `Link` relation for the response roles. Styles live in the `pagings` catalogue; a format pack provides presets of them (section 15). Roles are core semantics: the core knows what each one means and who fills it, never what it is called.

```yaml
# shared/base.yaml (excerpt)
pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
      sort: { query: sort, style: signed }
    response:
      body: $items
      links: { next: $next }
  changes:
    request:
      since: { query: since }
      limit: { query: limit }
    response:
      body: { items: $items, next: $nextSince, complete: $complete }
```

| Key | Meaning |
|---|---|
| `request` | request roles, each `{ query: <name> }` or `{ header: <name> }`; `page` also takes `base` (`1` by default, or `0`), `sort` takes `style` and, for `style: split`, `direction` |
| `response.meta` | members added to the format's page: each maps a member name to a template over the response roles, and joins the `$meta` slot of the format's `success.page` |
| `response.body` | instead of `meta`: the whole page body, replacing the format's `success.page` body; a template whose slots are the response roles and `$meta`, with `$items` exactly once |
| `response.headers` | response headers, each a template (`X-Total-Count: $total`) |
| `response.links` | RFC 8288 relations written in one `Link` header, each mapped to a URL role (`next: $next`) |
| `absent` | as on a format; `omit` by default |

A style without `body` keeps the format's page shape and adds to it, so the wrapper stays the format's and a style survives a change of format. Under `@seampact/pack-laravel`, whose page shape is `{ data: $items, meta: $meta }`:

```yaml
# shared/base.yaml (excerpt)
pagings:
  pages:
    request:
      page: { query: page }
      limit: { query: perPage }
    response:
      meta: { page: $page, lastPage: $totalPages, perPage: $limit, total: $total }
```

A page of `pages` is `{ data: [...], meta: { page, lastPage, perPage, total } }`, plus the format's own `meta` fields when it declares some (a `servedAt` filled with `now`); a member named by both the format and the style is a compile error naming both. A style with `meta` under a format whose page shape writes no `$meta`, such as `bare` (`$items`), is a compile error naming the style and the format, with the fix "write `response.body`". A style with `body` replaces the page body, as Hydra, HAL and JSON:API need; inside it, `$meta` holds the format's `meta` fields only, and those fields appear in a page only where a template writes `$meta`. `headers` and `links` add to the page in both cases.

Request roles. A style has exactly one position role (`cursor`, `page`, `offset` or `since`), or the pair `after` and `before`, which sets its kind:

| Role | Meaning |
|---|---|
| `cursor` | an opaque position the handler issued |
| `after`, `before` | a cursor kind whose two directions travel in two parameters (Stripe's `starting_after` and `ending_before`): records after the position, or before it. A request sends at most one of the two; both answer 400 |
| `page` | a page number, counted from `base` |
| `offset` | the number of records to skip |
| `since` | a changes-since token: opaque, or a `date-time` with `token: instant` (SCN-082) |
| `limit` | the page size, from 1 to the route's `maxLimit`. A larger value answers 400 (SCN-012), or, with `overLimit: clamp`, is served as `maxLimit`, which the `limit` response role then reports, as Spring Data, GitHub and API Platform do. A style without it serves `defaultLimit` records per page |
| `sort` | the sort keys of `sortable`; `style` is `signed` (`sort=-createdAt,title`), `pair` (`sort=createdAt,desc`, repeated), `keyed` (the name holds `{key}`: `order[createdAt]=desc`) or `split` (one key, its direction `asc` or `desc` in the parameter `direction` names: `sort=created&direction=desc`) |

Response roles, each a slot of the body, a header or a link:

| Role | Value | Filled by | Kinds |
|---|---|---|---|
| `items` | the page's records | handler | all |
| `nextCursor`, `previousCursor` | the cursors of the next and previous pages, absent at either end; with `after` and `before`, the values those parameters take | handler | cursor |
| `more` | whether records follow this page (Stripe's `has_more`, a `hasNext` flag) | handler | all |
| `page`, `offset`, `limit` | the request's position and the limit applied | boundary | page, offset; `limit` all |
| `from`, `to` | the one-based positions of the first and last record of the page | boundary | page, offset |
| `total` | the number of records of the whole list | handler | cursor, page, offset |
| `totalPages` | `total` divided by `limit`, rounded up | boundary | page, offset |
| `self`, `first`, `previous`, `next`, `last` | page URLs: the request URL with its position replaced | boundary | `last` page and offset only |
| `nextSince`, `complete` | the token for the next call, and whether every change up to it is included | handler | since |

The handler result is typed from the roles the style uses: the items, plus `nextCursor`, `previousCursor`, `more`, `nextSince` and `complete` when used, and `total` when the style uses `total`, `totalPages` or `last`, whether or not a template writes `$total` (a `lastPage` member without the total is that case). A page or offset style that needs no total also asks the handler for `more`, which drives `next`. A role used outside its kinds, a sort key on a style without a `sort` role, and a request name already used by the route's `query` are compile errors naming the style. The route sets the limits (`maxLimit`, `defaultLimit`, `overLimit`), or they come from `conventions.paging`, each one on its own: a `conventions.paging.defaultLimit` above the route's `maxLimit` is lowered to it, while a route's `defaultLimit` above the `maxLimit` it gets, or a `conventions.paging.defaultLimit` above `conventions.paging.maxLimit`, is a compile error.

Two third-party styles show the roles at work, Stripe's list object and GitHub's pages:

```yaml
# shared/base.yaml (excerpt)
pagings:
  stripeList:
    request:
      after: { query: starting_after }
      before: { query: ending_before }
      limit: { query: limit }
    response:
      body: { object: list, data: $items, has_more: $more, url: $path }
  githubPages:
    request:
      page: { query: page }
      limit: { query: per_page }
      sort: { query: sort, style: split, direction: direction }
    response:
      body: $items
      links: { next: $next, prev: $previous, first: $first, last: $last }
conventions:
  paging: { maxLimit: 100, overLimit: clamp }
```

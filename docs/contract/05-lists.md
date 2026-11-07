# Lists

A list is a route that returns many records. It needs a paging style, so a client always knows how to ask for the next page.

## Declare a paging style

A style says which query parameters a client sends and how the page comes back. It lives under `pagings`. seampact imposes no shape: you write the body your clients expect. A list without a style fails to compile, and the error shows an example.

A cursor, with the next page in a `Link` header. Add it as a top-level `pagings` block of `contract/api.yaml`:

```yaml
pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
    response:
      body: $items
      links: { next: $next }
```

`$items` is where the records go. `$next` is the link to the next page. The client sends `?cursor=...&limit=20`, and the body is the array of records.

## More styles

Page numbers, with the page facts under a `meta` key:

```yaml
pagings:
  pages:
    request:
      page: { query: page }
      limit: { query: limit }
    response:
      body: { items: $items, meta: { page: $page, limit: $limit, total: $total } }
```

The client sends `?page=2&limit=20` and gets `{ "items": [...], "meta": { "page": 2, "limit": 20, "total": 57 } }`.

Page facts as flat members beside the items use `$page` and `$totalPages`: `body: { items: $items, page: $page, totalPages: $totalPages }`.

A style can take its cursor in two parameters, as Stripe does (`after` and `before`). A request sends one of the two. Both answer `400`. See [Paging styles](../grammar/14-paging-styles.md) for every role.

## Use it on a list

```yaml
# contract/api.yaml, under surfaces.app.routes
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  ops:
    list:
      paging: { cursor: { maxLimit: 50, defaultLimit: 20 } }
      sortable: [createdAt, title]
```

- `maxLimit` is required for a style with a `limit`. A larger `limit` answers `400`. With `overLimit: clamp` it is served as `maxLimit` instead.
- `defaultLimit` is the page size when the client sends none.
- `sortable` lists the fields a client may sort by: `?sort=-createdAt,title`. It needs a `sort` in the style: add `sort: { query: sort, style: signed }` to `request`. `signed` means a `-` before a field sorts it downward.

To use one style on every list, set it once. Then a list writes no `paging`.

```yaml
# contract/api.yaml, top level
conventions:
  paging: { default: cursor, maxLimit: 50 }
```

## Serve the whole list

For a short list that never grows, skip paging.

```yaml
# under a collection node
ops:
  list: { paging: none }
```

## Use `item`, not `output`

On a custom route that returns many records, write `item: Note`. `output` is always the whole body. An array `output` on a `GET` is refused.

## A list in a query parameter

A query parameter that is a list, such as `state?: { type: array, items: TaskState }`, travels as repeated keys by default: `?state=open&state=done`. Choose another form once for the api:

```yaml
# contract/api.yaml, top level
conventions:
  query: { lists: comma }
```

- `repeat` (default): `?state=open&state=done`. Every server and client reads it.
- `comma`: `?state=open,done`. Every server and client reads it.
- `brackets`: `?state[]=open&state[]=done`. No target reads it yet.

If a target refuses the form, `generate` says which and how to fix it: see [Target option errors](../troubleshooting/generate.md).

## Ready-made styles

A convention pack brings a ready-made paging style. Add one under `packs` instead of writing your own. See [Convention packs](../features/convention-packs.md) for the packs that generate code today.

## Next

- Next: [Versioning and change](06-versioning.md).
- In depth: [Paging styles](../grammar/14-paging-styles.md) and [Lists, cache and lifecycle](../grammar/10-lists-cache-and-lifecycle.md) (`cache`, `filteredBy`, `budget`).

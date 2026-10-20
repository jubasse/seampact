# Lists

A list is a route that returns many records. It needs a paging style, so a client always knows how to ask for the next page.

## Declare a paging style

A style says which query parameters a client sends and how the page comes back. It lives under `pagings`. seampact imposes no shape: you write the body your clients expect. A list without a style fails to compile, and the error shows an example.

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

A cursor, with the next page in a `Link` header:

```yaml
pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
      sort: { query: sort, style: signed }
    response:
      body: $items
      links: { next: $next }
```

The client sends `?cursor=...&limit=20`, and the body is the array of records.

Page facts as flat members beside the items:

```yaml
pagings:
  flatPages:
    request:
      page: { query: page }
      limit: { query: limit }
    response:
      body: { items: $items, page: $page, totalPages: $totalPages }
```

The body is `{ "items": [...], "page": 2, "totalPages": 3 }`.

## Use it on a list

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  ops:
    list:
      paging: { cursor: { maxLimit: 50, defaultLimit: 20 } }
      sortable: [createdAt, title]
```

- `maxLimit` is required for a style with a `limit`. A larger `limit` answers `400`.
- `defaultLimit` is the page size when the client sends none.
- `sortable` lists the fields a client may sort by: `?sort=-createdAt,title`. It needs a `sort` in the style.

To use one style on every list, set it once. Then a list writes no `paging`.

```yaml
conventions:
  paging: { default: cursor, maxLimit: 50 }
```

## Serve the whole list

For a short list that never grows, skip paging.

```yaml
ops:
  list: { paging: none }
```

## Use `item`, not `output`

On a route that is not an `op`, write `item: Note` to make it a list. `output` is always the whole body. An array `output` on a `GET` is refused with this fix.

## Ready-made styles

Format packs bring styles for JSON:API, HAL, Laravel, Spring and API Platform. Add one under `packs` instead of writing your own. See [Convention packs](../grammar/15-first-party-pack-presets.md).

## What is next

- Every paging role and example: [Paging styles](../grammar/14-paging-styles.md).
- List settings (`cache`, `filteredBy`, `budget`): [Lists, cache and lifecycle](../grammar/10-lists-cache-and-lifecycle.md).

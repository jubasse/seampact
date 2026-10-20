# The shape of a contract

A contract is one YAML file, `api.yaml`. This page shows its parts. The notes contract from [Write the contract](../getting-started/02-first-contract.md) is the base.

## The four blocks

```yaml
api:
  name: notes
  version: 1
  kind: product
  maturity: provisional

schemas:
  NoteId: { type: string, format: uuid }

surfaces:
  app:
    prefix: /v{version}
    routes: {}
```

- `api` names the api. `version: 1` gives the `/v1` in every path.
- `schemas` holds the shapes of your data.
- `surfaces` holds the routes. A surface is an entry point with a path prefix.
- Other blocks (`errors`, `pagings`, `enums`, `identities`) are covered in the next pages.

## A collection

A collection is a list of records with an id. `ops` picks the standard operations.

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  ops:
    get: {}
    create: { input: CreateNote }
    update: { input: CreateNote }
    delete: {}
```

| Op | Route | Success |
|---|---|---|
| `list` | `GET /v1/notes` | `200` (needs a paging style: see [Lists](05-lists.md)) |
| `get` | `GET /v1/notes/{noteId}` | `200` |
| `create` | `POST /v1/notes` | `201` |
| `update` | `PATCH /v1/notes/{noteId}` | `200` |
| `delete` | `DELETE /v1/notes/{noteId}` | `204` |

`create` and `update` need an `input` schema, so write `ops` as a mapping. Each op that needs nothing takes `{}`.

## A route of your own

For anything else, write a route. It has a `method`, an optional `input` and an `output`.

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  ops: [get]
  member:
    routes:
      pin:
        method: post
        output: Note
```

A route under `member` works on one note: `POST /v1/notes/{noteId}/pin`. The operation id is `pinNote`, and it is the name of the method you write.

A route that sets no `output` answers `204` with no body.

## Query parameters

Declare them on the route. A name ending with `?` is optional. A route on the whole collection goes under `collection`.

```yaml
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  collection:
    routes:
      search:
        method: get
        query: { text: { type: string }, limit?: { type: integer, minimum: 1, maximum: 50 } }
        output: Note
```

A query key the route does not declare is refused.

## What is next

- Types and references: [Types and references](02-types-and-refs.md).
- Every route key: [Routes](../grammar/07-routes.md) and [Surfaces and the tree](../grammar/06-surfaces-and-the-tree.md).

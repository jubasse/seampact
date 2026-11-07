# The shape of a contract

Read this first. It shows the parts of a contract and where each one goes. The notes contract from [Write the contract](../getting-started/02-first-contract.md) is the base.

A contract starts in one file, `contract/api.yaml`. Every snippet in these pages says where it goes: at the top of that file, or under a named key.

## The main blocks

```yaml
# contract/api.yaml
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
    access: { public: "Anyone may call this api: it has no accounts." }
    routes: {}
```

- `api` names the api. `version: 1` gives the `/v1` in every path.
- `kind` is `product` (the default: an api for apps and their users) or `service` (an internal api with a caller identity). Leave it out for a product.
- `maturity` is how much you promise: `experimental`, `provisional` or `stable`. See [Versioning and change](06-versioning.md).
- `schemas` holds the shapes of your data.
- `surfaces` holds the routes. A surface is a group of routes under one prefix and one access rule, such as `app` for browsers and `admin` for staff.
- Other blocks (`errors`, `pagings`, `enums`, `identities`) are top-level too. The next pages cover them.

A route is a YAML entry that becomes one HTTP endpoint. An operation (`op`) is a standard route you get from `ops`, such as `list` or `get`.

## Settings flow down the tree

The routes of a surface sit in a tree.

```text
surface
  collection node (notes)
    member (one note)
      route
    collection (the whole list)
      route
```

A setting on a node applies to every route below it. These settings flow down: `identity`, `access`, `requires`, `errors`, `errorRoles`, `maturity`, `cache` and `lint.allow`.

`requires` and `errors` add up as you go down. For the others, the nearest node wins, so a route can override what its parent says.

Other pages say "every route below it". They mean this rule.

## Where a snippet goes

- A snippet that starts at `errors:`, `pagings:`, `schemas:`, `enums:`, `rights:` or `identities:` is a top-level block of `api.yaml`.
- A snippet that starts at a route name, such as `notes:`, goes under `surfaces.<surface>.routes`.
- A snippet that starts at `member:` or `collection:` goes under a route node.

## A collection

A collection is a list of records with an id. `ops` picks the standard operations.

```yaml
# contract/api.yaml, under surfaces.app.routes
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

`ops: [get, list]` is enough when no op needs options. Use the mapping form as soon as one does: `create` and `update` need an `input` schema. An op that needs nothing takes `{}`.

`collection:` holds routes on the whole list. `member:` holds routes on one record.

## A route of your own

For anything else, write a route. It has a `method`, an optional `input` and an `output`.

```yaml
# contract/api.yaml, under surfaces.app.routes
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

A route under `member` works on one note: `POST /v1/notes/{noteId}/pin`. seampact names this operation `pinNote`. The generated handler has a method with that name, and you write its body.

A route that sets no `output` answers `204` with no body.

## Query parameters

Declare them on the route. A name ending with `?` is optional. A route on the whole collection goes under `collection`.

```yaml
# contract/api.yaml, under surfaces.app.routes
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  collection:
    routes:
      search:
        method: get
        query: { text: { type: string }, limit?: { type: integer, minimum: 1, maximum: 50 } }
        item: Note
```

A query key the route does not declare is refused with a `400`.

## Next

- Next: [Types and references](02-types-and-refs.md).
- In depth: [Routes](../grammar/07-routes.md) and [Surfaces and the tree](../grammar/06-surfaces-and-the-tree.md).

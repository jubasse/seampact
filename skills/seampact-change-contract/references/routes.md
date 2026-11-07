<!-- Generated from docs/contract/01-basics.md, docs/contract/02-types-and-refs.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# The shape of a contract

Page: https://jubasse.github.io/seampact/contract/01-basics/

Read this first. It shows the parts of a contract and where each one goes. The notes contract from [Write the contract](https://jubasse.github.io/seampact/getting-started/your-first-api/#2-write-the-contract) is the base.

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
- `maturity` is how much you promise: `experimental`, `provisional` or `stable`. See [Versioning and change](https://jubasse.github.io/seampact/contract/06-versioning/).
- `schemas` holds the shapes of your data.
- `surfaces` holds the routes. A surface is a group of routes under one prefix and one access rule, such as `app` for browsers and `admin` for staff.
- Other blocks (`errors`, `pagings`, `enums`, `identities`) are top-level too. The next pages cover them.

A [route](https://jubasse.github.io/seampact/concepts/glossary/) is a YAML entry that becomes one HTTP endpoint. An operation (`op`) is a standard route you get from `ops`, such as `list` or `get`.

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
| `list` | `GET /v1/notes` | `200` (needs a paging style: see [Lists](https://jubasse.github.io/seampact/contract/05-lists/)) |
| `get` | `GET /v1/notes/{noteId}` | `200` |
| `create` | `POST /v1/notes` | `201` |
| `update` | `PATCH /v1/notes/{noteId}` | `200` |
| `delete` | `DELETE /v1/notes/{noteId}` | `204` |

`ops: [get, delete]` is enough when no op needs options. `list` always needs options: it names a paging style (see [Lists](https://jubasse.github.io/seampact/contract/05-lists/)). Use the mapping form as soon as one does: `create` and `update` need an `input` schema. An op that needs nothing takes `{}`.

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

- Next: [Types and references](https://jubasse.github.io/seampact/contract/02-types-and-refs/).
- In depth: [Routes](https://jubasse.github.io/seampact/grammar/07-routes/) and [Surfaces and the tree](https://jubasse.github.io/seampact/grammar/06-surfaces-and-the-tree/).

# Types and references

Page: https://jubasse.github.io/seampact/contract/02-types-and-refs/

Use this page to describe your data. Every body, query field and id is a schema. Schemas live under `schemas` and are used by name.

## Write a schema

```yaml
# contract/api.yaml, top level
schemas:
  NoteId: { type: string, format: uuid }
  Color: { enum: Palette }
  Note:
    type: object
    required: [noteId, title, createdAt]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000, nullable: true }
      tags: { type: array, items: { type: string }, maxItems: 10 }
      color: Color
      createdAt: { type: string, format: date-time }

enums:
  Palette: { values: [red, green, blue], reason: "Colors are local to this api." }
```

- Types are `string`, `integer`, `number`, `boolean`, `object` and `array`.
- A property is optional unless it is in `required`. In `query`, `headers` and `id`, a name ending with `?` is optional.
- `nullable: true` lets the value be `null`. Optional and nullable are two different things.
- A schema name starts with a capital letter. Use the name wherever a schema fits: `item: Note`, `input: CreateNote`, `noteId: NoteId`.
- An enum needs a `reason`: one sentence a reviewer reads, such as why this api owns its list of values.

## Unsupported schema forms

A schema holds only what every server and client library can check. `anyOf` and type arrays such as `[string, "null"]` are refused. Use `nullable`, or `oneOf` with a discriminator ([schema language](https://jubasse.github.io/seampact/grammar/04-scalars-names-and-value/)).

## Split a contract into files

Move schemas to their own file and include it.

```yaml
# api.yaml
schemas:
  $include: ./schemas.yaml
```

```yaml
# schemas.yaml
NoteId: { type: string, format: uuid }
Note:
  type: object
  required: [noteId]
  properties:
    noteId: NoteId
```

`$include` pastes the file in place. Paths are relative to the file that holds them and stay inside the folder that holds your contract.

To share one base between several apis, use `extends`: see [Advanced](https://jubasse.github.io/seampact/contract/07-advanced/#share-a-base-between-apis).

## Next

- Next: [Errors](https://jubasse.github.io/seampact/contract/03-errors/).
- In depth: [Composition](https://jubasse.github.io/seampact/grammar/02-composition-extends-packs-include/).

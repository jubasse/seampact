---
name: seampact-change-contract
description: Add or change an API route, schema, error, access rule or paging style in a seampact contract (contract/*.yaml, seampact.config.yaml). Use for "add an endpoint", "add a list route with paging", "make this route need login", "add an error", "rename a field" in any repo that holds seampact.config.yaml, even if the user never says seampact. Not for handler code (seampact-implement-handler) and not for a seampact error code (seampact-fix-error).
---

# Change the contract

The contract is the source of truth. Generated code follows it; you never edit generated code.

1. Open `seampact.config.yaml`. Its `sources` name the contract folder (`contract/` by default). Read `contract/api.yaml` and copy the style of the nearest existing route.
2. Make the YAML edit. The pattern below covers the commonest case; for the rest open the one reference that matches, not all of them.
3. Run `lint`, then `generate`, then `check` (the command lines for this stack are in AGENTS.md). Fix what they print, one error at a time. Every error ends with `Fix:`.
4. Generation changes the handler types. Now switch to `seampact-implement-handler`.
5. When clients already use the API, run `diff --against <baseline>` and tell the user what it reports as breaking.

## A list with paging

A list route needs a paging style. A list without one fails to compile, and the error shows an example.

Declare the style once, at the top level of `contract/api.yaml`:

```yaml
# contract/api.yaml, top level
pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
    response:
      body: $items
      links: { next: $next }
```

Use it on the list operation:

```yaml
# contract/api.yaml, under surfaces.app.routes
notes:
  kind: collection
  id: { noteId: NoteId }
  item: Note
  ops:
    list:
      paging: { cursor: { maxLimit: 50, defaultLimit: 20 } }
```

- `maxLimit` is required when the style has a `limit`. A larger limit answers 400.
- `sortable: [createdAt]` on the list needs `sort: { query: sort, style: signed }` in the style's `request`.
- To use one style on every list, set `conventions: { paging: { default: cursor, maxLimit: 50 } }` and write no `paging` on the lists.
- A custom route that returns many records uses `item: Note`, not `output`.
- A short list that never grows: `list: { paging: none }`.
- If the repo already has a `pagings` entry, use it; do not add a second one. Match the style to what existing clients send.

## References, open only the one you need

- `references/routes.md`: collections, single routes, ops, path ids, schemas, enums
- `references/errors.md`: declare an error, attach it, change a code
- `references/access.md`: public routes, identities, rights, scopes
- `references/versioning.md`: maturity, deprecation, lost updates, uploads, cache
- `references/paging-styles.md`: page numbers, two-parameter cursors, every response role

## Stop and ask the user

- before removing an operation, a field or a header to make an error go away;
- before changing the shape of a response that clients already read.

# Convention packs

Use a pack to reuse conventions: a response format, a paging style, or rules for rights. Add one to your contract with one line.

```yaml
# top of contract/api.yaml
packs: ["@seampact/pack-spring"]
```

Write it at the top level of `api.yaml`, or of the shared file to give it to every api. The packs are npm packages: on Node, install them with the other seampact packages. A pack is data, not code.

## What each pack brings

Only `pack-spring`, `pack-crud-rights` and `pack-laravel` generate code today. The others load, and a target refuses what it cannot generate, by name. Nothing is generated half way.

| Pack | Brings | Generates today |
|---|---|---|
| `@seampact/pack-spring` | The `springPage` paging style. | Yes, on Spring Boot, where a list gets Spring Data's `Page`. Node servers refuse its `pair` sort on a list with `sortable` (`paging.sort.style.unsupported`). |
| `@seampact/pack-crud-rights` | A right `<resource>.<op>` for every list, get, create, update, delete and batch route. Use it on routes with an identity. | Yes, on routes with an identity. |
| `@seampact/pack-laravel` | The `laravel` format, with `data` wrapping, and its two paging styles. | Yes: types, validators, the fetch client, Node servers, Laravel, Symfony, Spring Boot and the Python servers. |
| `@seampact/pack-hal` | The `hal` format and `halPages` paging: `_links` and `_embedded`. | Planned. |
| `@seampact/pack-jsonapi` | The `jsonapi` format and `jsonapiPages` paging: resource objects and an `errors` array. | Planned. |
| `@seampact/pack-api-platform` | JSON-LD items, Hydra collections and the `iri-reference` format. | Planned, after 1.0. |

A format or paging pack sets it as the default for the api. You can still choose another on a route. The refusal a planned pack gives names the form and the fix: see [Generate errors](../troubleshooting/generate.md).

## Your own pack

A pack file in your contract works the same way. See [Grammar 2](../grammar/02-composition-extends-packs-include.md) for its keys.

## The packs in full

The formats and paging styles of the packs, written in the grammar: [Grammar 15](../grammar/15-first-party-pack-presets.md).

A pack that is not installed gives `seampact/load/pack-not-found`. See [Contract file errors](../troubleshooting/load.md).

## Next

[Lists](../contract/05-lists.md) shows how a paging style is used, or go to [Diff](diff.md).

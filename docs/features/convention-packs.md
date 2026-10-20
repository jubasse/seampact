# Convention packs

A pack is a set of conventions you reuse: a response format, a paging style, or rules for rights. Add one to your contract with one line.

```yaml
packs: ["@seampact/pack-hal"]
```

Write it at the top level of `api.yaml`, or of the shared file to give it to every api. `install-into.ts` installs the packs with the other seampact packages. A pack is data, not code.

## What each pack brings

| Pack | Brings |
|---|---|
| `@seampact/pack-hal` | The `hal` format and `halPages` paging: `_links` and `_embedded`. |
| `@seampact/pack-jsonapi` | The `jsonapi` format and `jsonapiPages` paging: resource objects and an `errors` array. |
| `@seampact/pack-api-platform` | JSON-LD items, Hydra collections and the `iri-reference` format. |
| `@seampact/pack-laravel` | The `laravel` format, with `data` wrapping, and its two paging styles. |
| `@seampact/pack-spring` | The `springPage` paging style. |
| `@seampact/pack-crud-rights` | A right `<resource>.<op>` for every list, get, create, update, delete and batch route, required first. Use it on routes with an identity: a public route has no caller to hold the right. |

A format or paging pack sets it as the default for the api. You can still choose another on a route.

## Your own pack

A pack file in your contract works the same way. See [Grammar 2](../grammar/02-composition-extends-packs-include.md) for its keys.

## The packs in full

The formats and paging styles of the packs, written in the grammar: [Grammar 15](../grammar/15-first-party-pack-presets.md).

A pack that is not installed gives `seampact/load/pack-not-found`. See [Contract file errors](../troubleshooting/load.md).

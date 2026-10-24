# React

seampact writes TanStack Query 5 options and hooks for React 19, over the typed `fetch` client. SWR and RTK Query come next.

## Add the targets

```yaml
targets:
  - id: types
    use: "@seampact/codegen-ts"
    apis: [notes]
  - id: client
    use: "@seampact/codegen-fetch"
    apis: [notes]
    link: { types: types }
  - id: queries
    use: "@seampact/codegen-react"
    apis: [notes]
    options: { query: tanstack }
    link: { client: client }
```

Install `@tanstack/react-query` 5, then run `npx seampact generate`.

## Use the hooks

```tsx
const Notes = createNotesHooks(createClient({ baseUrl: window.location.origin }));

const notes = Notes.useListNotes({});
const create = Notes.useCreateNote();
```

Wrap your app in TanStack's `QueryClientProvider`. After a write, the hooks refresh the queries of the same resource.

A list whose paging style tells the next page also gets `use<Op>Infinite`, for example `useListNotesInfinite`.

A declared error is thrown as a `ContractError`. `isContractError(error)` tells it apart from a network failure.

## Options

| Option | Values | Default |
|---|---|---|
| `query` | `tanstack` | required |
| `errors` | `throw`, `data` (the whole reply as data) | `throw` |
| `invalidate` | `resource`, `off` | `resource` |
| `staleTime` | `off`, `contract` (freshness from the contract's `cache`) | `off` |
| `infinite` | `on`, `off` | `on` |
| `useClientDirective` | `on`, `off` (the `"use client"` line on hook files) | `on` |
| `keys.root` | a name | the api id |

`errors: data` needs a client with `errorStyle: result`, which is the client's default.

`artefacts: { hooks: false }` keeps the options factories only. `artefacts: { itemsOf: true }` adds `itemsOf`.

Errors: [Generate errors](../troubleshooting/generate.md).

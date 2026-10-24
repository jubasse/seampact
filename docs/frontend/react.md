# React

seampact writes React hooks over the typed `fetch` client, for TanStack Query 5, SWR 2 or RTK Query 2. Pick one with the `query` option.

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

Install the library you picked: `@tanstack/react-query` 5, `swr` 2, or `@reduxjs/toolkit` 2.6 or later with `react-redux` 9. Then run `npx seampact generate`.

## Use the hooks

```tsx
const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
const Notes = createNotesHooks(client);

const notes = Notes.useListNotes({});
const create = Notes.useCreateNote();
```

`VITE_API_URL` holds your backend URL: see [Point the client at your backend](backend-url.md). With TanStack Query, wrap your app in `QueryClientProvider`; SWR's hooks have the same names. After a write, the hooks refresh the queries of the same resource.

With RTK Query, `createNotesApi(client)` returns an RTK api: add its `reducer` and `middleware` to your store, and use RTK's hook names (`notesApi.useListNotesQuery({})`, `notesApi.useCreateNoteMutation()`).

A list whose paging style tells the next page also gets `use<Op>Infinite`, for example `useListNotesInfinite`. With RTK Query it is `useListNotesPagesInfiniteQuery`.

A declared error is thrown as a `ContractError`. `isContractError(error)` tells it apart from a network failure.

## Options

| Option | Values | Default |
|---|---|---|
| `query` | `tanstack`, `swr`, `rtk` | required |
| `errors` | `throw`, `data` (the whole reply as data) | `throw` |
| `invalidate` | `resource`, `off` | `resource` |
| `staleTime` | `off`, `contract` (freshness from the contract's `cache`; TanStack Query only) | `off` |
| `infinite` | `on`, `off` | `on` |
| `useClientDirective` | `on`, `off` (the `"use client"` line on hook files) | `on` |
| `keys.root` | a name (not with RTK Query) | the api id |

## SWR and RTK Query

- SWR passes no abort signal, so a request runs to its end. A mutation has no retry.
- RTK Query's hooks never abort a request on unmount. A mutation has no retry.
- RTK Query keeps errors as plain values in the store, with a `kind`: `contract` (a declared error or an unexpected answer) or `rejection` (network failure, timeout, abort). `toContractError(error)`, exported by the api's `api.ts`, turns a `contract` one back into a `ContractError`.
- `staleTime: contract` is refused with both: set the library's own freshness setting instead.

`errors: data` needs a client with `errorStyle: result`, which is the client's default.

`artefacts: { hooks: false }` keeps the options factories only. `artefacts: { itemsOf: true }` adds `itemsOf`.

Errors: [Generate errors](../troubleshooting/generate.md).

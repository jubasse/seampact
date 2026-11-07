# React

seampact writes React hooks over the [fetch client](fetch-client.md), for TanStack Query 5, SWR 2 or RTK Query 2, or with no query library. Pick one with the `query` option. Use it for a React web app; for a phone, see [Expo and React Native](mobile.md).

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

Install the library you picked: `@tanstack/react-query` 5, `swr` 2, or `@reduxjs/toolkit` 2.6 or later with `react-redux` 9. `query: fetch` needs nothing but React. Then run `npx seampact generate`.

## Use the hooks

```tsx
import { createClient } from "./__generated__/client/notes/index.js";
import { createNotesHooks } from "./__generated__/queries/notes/index.js";

const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
const Notes = createNotesHooks(client);

export function NoteList() {
  const notes = Notes.useListNotes({});
  const create = Notes.useCreateNote();

  // ...
}
```

`VITE_API_URL` is the Vite variable for your backend URL (other tools read it elsewhere): see [Point the client at your backend](backend-url.md). After a write, the hooks refresh the queries of the same resource.

- TanStack Query: wrap your app in `QueryClientProvider`.
- SWR: the hooks have the same names, no provider needed.
- RTK Query: `createNotesApi(client)` returns an RTK api. Add its `reducer` and `middleware` to your store, and use RTK's hook names (`notesApi.useListNotesQuery({})`, `notesApi.useCreateNoteMutation()`).

A list whose paging style tells the next page also gets `use<Op>Infinite`, for example `useListNotesInfinite`. With RTK Query it is `useListNotesPagesInfiniteQuery`.

## Errors

A declared error is thrown as a `ContractError`. `isContractError(error)` tells it apart from a network failure. Fields and `errorStyle`: [Fetch client](fetch-client.md#contracterror).

## Options

| Option | Values | Default |
|---|---|---|
| `query` | `tanstack`, `swr`, `rtk`, `fetch` (no library) | required |
| `errors` | `throw`, `data` (the whole reply as data) | `throw` |
| `invalidate` | `resource`, `off` (not with `fetch`) | `resource` |
| `staleTime` | `off`, `contract` (freshness from the contract's `cache`; TanStack Query only) | `off` |
| `infinite` | `on`, `off` (not with `fetch`) | `on` |
| `useClientDirective` | `on`, `off` (the `"use client"` line on hook files) | `on` |
| `keys.root` | a name (not with RTK Query or `fetch`) | the api id |

## SWR and RTK Query

- SWR passes no abort signal, so a request runs to its end. A mutation has no retry.
- RTK Query's hooks never abort a request on unmount. A mutation has no retry.
- RTK Query keeps errors as plain values in the store, with a `kind`: `contract` (a declared error or an unexpected answer) or `rejection` (network failure, timeout, abort). `toContractError(error)`, exported by the api's `api.ts`, turns a `contract` one back into a `ContractError`.
- `staleTime: contract` is refused with both: set the library's own freshness setting instead.

## Without a query library

`query: fetch` means React's own state and effects, with no query library. The client under it is still the fetch client.

```tsx
import { createClient } from "./__generated__/client/notes/index.js";
import { createNotesHooks } from "./__generated__/queries/notes/index.js";

const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
const Notes = createNotesHooks(client);

export function NoteList() {
  const notes = Notes.useListNotes({}); // { data, error, isLoading, refetch }
  const create = Notes.useCreateNote({ retry: 1 }); // { mutate, isPending, error, data }

  const add = async () => {
    const { error } = await create.mutate({ body: { title: "New note" } });

    if (!error) notes.refetch();
  };

  // ...
}
```

Behaviours (skip, cache, `mutate`, `retry`, refused options): [shared with Vue and Angular](fetch-client.md#shared-behaviours-with-query-fetch). On React, hooks are created outside the components, and a read stops when the component unmounts.

`artefacts: { hooks: false }` keeps the options factories only. `artefacts: { itemsOf: true }` adds `itemsOf`.

## Limits

`generate` refuses a client with `errorStyle: throw` (`link.client.errorStyle.unsupported`) and the options listed above that a library does not take. See [Link errors](../troubleshooting/link.md) and the [client table](../troubleshooting/generate.md#clients).

## Next

[Point the client at your backend](backend-url.md), then [MSW mocks](msw.md) to test without a backend.

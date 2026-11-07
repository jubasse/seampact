# Vue

seampact writes Vue composables over the [fetch client](fetch-client.md), for TanStack Query 5 (`@tanstack/vue-query`), Pinia Colada 1 (`@pinia/colada`) or with no query library. Pick one with the `query` option. Use it for a Vue 3 web app.

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
    use: "@seampact/codegen-vue"
    apis: [notes]
    options: { query: tanstack }
    link: { client: client }
```

Install `@tanstack/vue-query` 5 for `query: tanstack`, or `pinia` and `@pinia/colada` 1 for `query: pinia-colada`. `query: fetch` needs nothing but Vue 3. Then run `npx seampact generate`.

## Use the composables

```vue
<script setup lang="ts">
import { createClient } from "./__generated__/client/notes/index.js";
import { createNotesComposables } from "./__generated__/queries/notes/index.js";

const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
const Notes = createNotesComposables(client);

const notes = Notes.useListNotes({});
const create = Notes.useCreateNote();
</script>
```

In a real app, create `client` and `Notes` once in their own module and import them. `VITE_API_URL` holds your backend URL: see [Point the client at your backend](backend-url.md). After a write, the composables refresh the queries of the same resource.

- TanStack Query: install `VueQueryPlugin` in your app.
- Pinia Colada: install Pinia, then `PiniaColada`.

A request can be a value, a `ref` or a getter (`() => ({ path: { id: props.id } })`): the query reads again when it changes.

A list whose paging style tells the next page also gets `use<Op>Infinite`, for example `useListNotesInfinite`.

The composables only read and write through the client. They keep no store: put what your app shares in your own Pinia store.

## Errors

A declared error is thrown as a `ContractError`. `isContractError(error)` tells it apart from a network failure. Fields and `errorStyle`: [Fetch client](fetch-client.md#contracterror).

## Options

| Option | Values | Default |
|---|---|---|
| `query` | `tanstack`, `pinia-colada`, `fetch` (no library) | required |
| `errors` | `throw`, `data` (the whole reply as data) | `throw` |
| `invalidate` | `resource`, `off` (not with `fetch`) | `resource` |
| `staleTime` | `off`, `contract` (freshness from the contract's `cache`) | `off` |
| `infinite` | `on`, `off` (not with `fetch`) | `on` |
| `keys.root` | a name (not with `fetch`) | the api id |

## With Pinia Colada

With `query: pinia-colada`, the options factories use Pinia Colada's `defineQueryOptions`, so `queryCache.getQueryData(Notes.listNotesOptions({}).key)` keeps its type.

```ts
const Notes = createNotesComposables(client);

// In a component's setup:
const notes = Notes.useListNotes({}); // { data, error, status, refetch, ... }
const pages = Notes.useListNotesInfinite({}); // { data, hasNextPage, loadNextPage, ... }
const create = Notes.useCreateNote(); // { mutate, mutateAsync, error, data, ... }
```

- Your caller options are Pinia Colada's own, spread after the generated ones; `key` replaces the generated key.
- A write that refreshes its resource takes the query cache. The composable injects it; the options factory takes it first: `Notes.createNoteMutationOptions(useQueryCache())`.
- Pinia Colada has no `select`: map `data` with a `computed`.
- seampact writes no Pinia store: the cache is Pinia Colada's.
- A failed list refresh after a write shows on the list; the write itself still succeeds.
- In server rendering, Pinia Colada and Vue Query run their own server reads: hydrating them or turning them off there is your choice. Only `query: fetch` never reads on the server.

## Without a query library

`query: fetch` means Vue's own `ref` and `watch`, with no query library. The client under it is still the fetch client.

```vue
<script setup lang="ts">
import { createClient } from "./__generated__/client/notes/index.js";
import { createNotesComposables } from "./__generated__/queries/notes/index.js";

const Notes = createNotesComposables(createClient({ baseUrl: import.meta.env.VITE_API_URL }));

const notes = Notes.useListNotes({}); // { data, error, isLoading, refetch }, each a ref
const create = Notes.useCreateNote({ retry: 1 }); // { mutate, isPending, error, data }

const add = async () => {
  const { error } = await create.mutate({ body: { title: "New note" } });

  if (!error) notes.refetch();
};
</script>
```

Behaviours (skip, cache, `mutate`, `retry`, refused options): [shared with React and Angular](fetch-client.md#shared-behaviours-with-query-fetch). On Vue:

- A read starts when the component mounts, so server rendering sends none: load server data your own way, or use a query library.
- Outside a component, a composable reads at once and stops only when its `effectScope` stops.

`artefacts: { composables: false }` keeps the options factories only. `artefacts: { itemsOf: true }` adds `itemsOf`.

## Limits

`generate` refuses a client with `errorStyle: throw` (`link.client.errorStyle.unsupported`) and the options listed above that a library does not take. See [Link errors](../troubleshooting/link.md) and the [client table](../troubleshooting/generate.md#clients).

## Next

[Point the client at your backend](backend-url.md), then [MSW mocks](msw.md) to test without a backend.

# Vue

seampact writes Vue composables over the typed `fetch` client, for TanStack Query 5 (`@tanstack/vue-query`) or with no query library. Pick one with the `query` option.

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

Install `@tanstack/vue-query` 5 for `query: tanstack`. `query: fetch` needs nothing but Vue 3. Then run `npx seampact generate`.

## Use the composables

```ts
const client = createClient({ baseUrl: import.meta.env.VITE_API_URL });
const Notes = createNotesComposables(client);

// In a component's setup:
const notes = Notes.useListNotes({});
const create = Notes.useCreateNote();
```

`VITE_API_URL` holds your backend URL: see [Point the client at your backend](backend-url.md). With TanStack Query, install `VueQueryPlugin` in your app. After a write, the composables refresh the queries of the same resource.

A request can be a value, a `ref` or a getter (`() => ({ path: { id: props.id } })`): the query reads again when it changes.

A list whose paging style tells the next page also gets `use<Op>Infinite`, for example `useListNotesInfinite`.

A declared error is thrown as a `ContractError`. `isContractError(error)` tells it apart from a network failure.

The composables only read and write through the client. They keep no store: put what your app shares in your own Pinia store.

## Options

| Option | Values | Default |
|---|---|---|
| `query` | `tanstack`, `fetch` (no library) | required |
| `errors` | `throw`, `data` (the whole reply as data) | `throw` |
| `invalidate` | `resource`, `off` (not with `fetch`) | `resource` |
| `staleTime` | `off`, `contract` (freshness from the contract's `cache`) | `off` |
| `infinite` | `on`, `off` (not with `fetch`) | `on` |
| `keys.root` | a name (not with `fetch`) | the api id |

## Without a query library

With `query: fetch`, the composables use Vue's own `ref` and `watch`. This is not the client's `fetch` style: that one names the client, this one the composables over it.

```ts
const Notes = createNotesComposables(client);

// In a component's setup:
const notes = Notes.useListNotes({}); // { data, error, isLoading, refetch }, each a ref
const create = Notes.useCreateNote({ retry: 1 }); // { mutate, isPending, error, data }

const add = async () => {
  const { error } = await create.mutate({ body: { title: "New note" } });

  if (!error) notes.refetch();
};
```

- Pass `null` as the request to skip a read.
- A read starts when the component mounts, so server rendering sends none: load server data your own way, or use `query: tanstack`.
- A read stops when the component unmounts or its request changes. Outside a component, a composable reads at once and stops only when its `effectScope` stops.
- There is no cache. A write does not refresh other composables: call `refetch`.
- `mutate` never throws. Each call resolves to its own `{ data }` or `{ error }`, a `ContractError` for a declared error. The `data`, `error` and `isPending` refs show the latest call.
- `retry` sends a failed write again with the same idempotency key, so the server runs it once. It takes a whole count (0 or more); another value makes the composable throw. A declared error is not retried.
- A write is not aborted when the component unmounts.
- There is no infinite composable: a paged list gets its plain one. Change the request to read the next page.
- `staleTime`, `invalidate`, `infinite`, `keys.root` and the `itemsOf` artefact need a query library: `generate` refuses them with `query: fetch`.

`errors: data` needs a client with `errorStyle: result`, which is the client's default.

`artefacts: { composables: false }` keeps the options factories only. `artefacts: { itemsOf: true }` adds `itemsOf`.

Errors: [Generate errors](../troubleshooting/generate.md).

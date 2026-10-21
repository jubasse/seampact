# ADR 0021: Front query targets and the React target

Status: accepted

## Context

`@seampact/codegen-fetch` generates, per api, a typed client: one method per operation that sends the request, fills the idempotency and deadline headers, reads the declared success, its page facts and the replay flag, and returns every declared error and unexpected answer as a result, or throws it as a `ContractError` under `errorStyle: throw`. `@seampact/codegen-react` generates, over that client, the queries and mutations a React app reads its server data through, for TanStack Query 5 (`query: tanstack`), SWR 2 (`query: swr`) or RTK Query 2 (`query: rtk`). `codegen-vue` and the state option of `codegen-angular` follow it, and the MSW target reuses its test harness, so this ADR also fixes what the front targets share.

A query library owns a cache keyed by a value the app computes, runs the request through a function it is given, retries failures, cancels requests a component no longer needs, and refreshes cached queries when a write makes them stale. Each of those is a place where generated code would impose a shape on the app. Seampact imposes none: every behaviour that shapes the app's cache or data can be turned off, except the contract's own wire guarantees ([A36](../decisions.md#a36)).

Three properties of the libraries shape the design. TanStack Query and SWR run in the browser and, for prefetch, on a server whose cache crosses into the browser as serialised data; RTK Query keeps its cache in a Redux store whose default middleware warns on any value that is not plain data. A library hands its request function an abort signal for queries (TanStack, RTK) or none (SWR). And TanStack retries a failed mutation by calling the mutation function again with the same variables.

## Options

- Where the contract's types come from: a `types` link to `codegen-ts`, or the linked client's method signatures. Choice: the client; the hooks call that client, so its request, success and error types are the ones the hooks pass on, and no second link can disagree with it.
- API form: hooks bound to a client held in a React context, or a factory bound to a client the app passes. Choice: the factory; an app that wants a provider wraps the factory's result in its own, and a server prefetch builds the same queries over a server client with no React tree.
- Primitive: one hook per operation, or an options factory per operation with the hook as a thin wrapper. Choice: the options factory, the TanStack Query 5 idiom; `useSuspenseQuery`, `useQueries`, `prefetchQuery` and `ensureQueryData` take it as is, so no hook per variant is generated.
- Declared errors: returned as query data, as the fetch client does by default, or thrown into the library's error state. Choice: the error state by default; the libraries drive retries, error boundaries and Suspense from it. `errors: data` returns the whole result as data.
- Refresh after a write: none, every query of the api, or the queries of the written resource. Choice: the written resource's, on by default, since a stale list after a create is the first bug a query library user meets; `invalidate: off` drops it.
- Freshness from the contract's `cache`: applied by default, or opt-in. Choice: opt-in (`staleTime: contract`); the browser's HTTP cache already applies `Cache-Control`, and a second layer that keeps data fresh without a request surprises.
- Default library: one, or none. Choice: none; `query` is required, and its refusal lists the three.
- Where the shared logic lives: in each front target, or a framework-neutral query plan in codegen-core with a small runtime copied into each front target's output. Choice: shared; Vue renders the same plan, and Angular's state option reads its keys and resource tags.
- End-to-end proof: hooks rendered in jsdom against a mocked `fetch`, or a real browser against a real seampact server. Choice: the browser and the server; the replay flag, the page facts read from headers and the abort on unmount only hold if a real browser reads a real server's answer.
- E2e server origin: cross-origin with CORS exposing the contract's response headers, or same-origin through Vite's `server.proxy`. Choice: same-origin; a cross-origin browser cannot read `Link`, `X-Total-Count`, `Retry-After` or the replay header unless the server lists them in `Access-Control-Expose-Headers`, and the spike shows the proxy works in Vitest browser mode.

## Decisions

### The client link

`codegen-react` needs a `client` link of style `fetch`, which `codegen-fetch` provides (ADR 0009 "The provider seam"). The `client` descriptor holds the module and the exports of `createClient`, `Client`, `ContractError` and `CallOptions`, the client's `errorStyle`, and the method name of each operation; the renderer reads the client's `errorStyle` to know whether it converts results. A react entry without a `client` link, or linked to another kind, fails `generate` with `link.missing` or `link.kind.mismatch`, whose fix names `@seampact/codegen-fetch`. A react entry that keeps an operation the client entry leaves out is refused by the CLI's existing `link.operations.missing`, whose fix is to keep the operation in the client entry's `document` and `operations`.

The generated code reads every type through the client: the request is `Parameters<Client["<op>"]>[0]`, the success data is the success arm of the method's result, and the error is the client's `ContractError` for the operation, carrying its `ErrorResult` or `UnexpectedResult`, or the rejection `Error` of a network failure, a timeout or an abort. No generated code has an `any` or a cast.

### The shared query plan and front runtime

`@seampact/codegen-core` gains a framework-neutral query plan, computed once per api from the IR and the client descriptor, that every front renderer reads:

- per operation, its form: a query for a `safe` operation, plus an infinite query when its paging style allows one (below), or a mutation for any other operation;
- the names of ADR 0007 for each export (`listTasksOptions`, `useListTasks`, `listTasksInfiniteOptions`, `createTaskMutationOptions`); two exports of one module with the same name are refused by name (`names.collision`), with the operation ids;
- the key segments, the resource type, the next-page rule and the call options the operation needs (a required timeout);
- the request header member of the idempotency key, when the operation has one.

A front runtime is copied into each front target's output with the generated header, as the server runtime is (ADR 0009 "What generated code depends on at run time"). It normalises a request into a key, builds the next page's request from the page facts, holds one idempotency key per mutation, turns a `result`-style client's error result into the `ContractError` the client would have thrown, and turns success headers into a plain record (below). It imports no Node built-in and no framework.

### The generated API

Per api, two modules, re-exported by the api's `index.ts` (ADR 0007 "Amendment 2026-10-19: generated modules"):

- `queries.ts`, server-safe: `create<Api>Queries(client, settings?)` returns `keys` and, per `safe` operation, `<op>Options(request, options?)` (`queryOptions`), plus `<op>InfiniteOptions(request, options?)` (`infiniteQueryOptions`) for a paged one, and per other operation `<op>MutationOptions(options?)` (`mutationOptions`). It holds no `"use client"` directive and imports no React hook, so a server component prefetches with it.
- `hooks.ts`, starting with `"use client"`: `create<Api>Hooks(client, settings?)` returns the same members plus `use<Op>(request, options?)` over `useQuery`, `use<Op>Infinite` over `useInfiniteQuery`, and `use<Op>(options?)` over `useMutation`.

```ts
const Tasks = createTasksHooks(client);

const tasks = Tasks.useListTasks({ query: { limit: 20 } });
const create = Tasks.useCreateTask();
const first = useSuspenseQuery(Tasks.listTasksOptions({ query: { limit: 20 } }));
```

The caller's options are spread after the generated ones, so every library option applies (`enabled`, `select`, `retry`, `staleTime`, `placeholderData`); only `queryFn` and `mutationFn` stay generated, and a caller's `queryKey` wins. A caller's `onSuccess` on a mutation runs after the generated invalidation. `options.call` passes the client's call options (`timeoutMs`); it is required, with `timeoutMs`, for an operation whose client method requires a timeout. `settings.idempotencyKey` replaces `crypto.randomUUID` as the key generator, as the client config's own does; a platform without either is refused when the factory is called, with that fix. The docs bind the result to a PascalCase name (`Tasks`), which the React hooks lint rule reads as a namespace of hooks.

### Keys

A query's key is `[<api>, { resource: <type> }, "<op>", request]`, or `[<api>, "<op>", request]` for an operation without a resource; the request is the caller's, without the headers the client fills (idempotency, deadline). `keys.all` is `[<api>]`, `keys.resource(type)` is `[<api>, { resource: type }]`, and `keys.<op>(request)` is the operation's key. The key holds no client, so a query prefetched over a server client and read over a browser client is one cache entry. The target option `keys.root` renames the first segment ([A36](../decisions.md#a36)).

### Data and errors

The data of a query is the client's success result with its `headers` turned from a `Headers` object into a plain record of lowercase names. A `Headers` object is not serialisable: React refuses it in the dehydrated state a server component passes to the browser, query persisters write it as `{}`, and RTK's serialisability check warns on it in the store (spike). The other members of the result, the page facts and the replay flag included, are kept as the client returns them.

A declared error or an unexpected answer reaches the library's error state as the client's typed `ContractError`: passed through from a `throw`-style client, built by the front runtime from a `result`-style client's error result. A network failure, a timeout or an abort is the client's rejection. Under `errors: data` the data is the client's whole result, success or error, headers turned into a record as above, and only a rejection reaches the error state; it is refused by name with a `throw`-style client (`options.errors.unsupported`), whose fix is to link a `result`-style client or drop `errors: data`.

### Invalidation and freshness

A mutation's success invalidates `keys.resource(<its resource type>)` before it runs the caller's `onSuccess`; an operation without a resource invalidates nothing. In TanStack Query the generated `onSuccess` reads the `QueryClient` from the mutation callbacks' context, so the factory takes none. `invalidate: off` drops it.

Under `staleTime: contract`, a query's `staleTime` is the operation's `cache.directives.maxAgeMs`, and 0 for an operation with `noStore`, `noCache` or no directives; without it the library's own default applies.

### Paged lists

The infinite query starts from the request's own position, and its next page's request sets the paging style's position role (`cursor`, `after`, `page` or `offset`, in the query or a header, grammar section 14) from the page facts the client read: `nextCursor`; the page, or the offset plus the limit, when `more` is true, when the page is below `totalPages`, when `total` with the limit says records follow, or when a `next` link is present; or the position parameter of the `next` link itself. No next fact ends the list. The pages are not flattened, since the shape is the app's; the opt-in artefact `itemsOf` exports `itemsOf(pages)`.

A `since` style, and a style whose facts give no next position, get no infinite query: `generate` warns by name (`paging.infinite.skipped`), with the operation and the reason, and the plain query stays. `infinite: off` generates no infinite query at all.

### Abort, timeouts and idempotency

The library's abort signal reaches the client's `CallOptions.signal`, so an unmounted query cancels its request. SWR passes no signal, and TanStack Query none to a mutation; the module comment says so.

A mutation of an idempotent operation sends one idempotency key per `mutate`, kept across the library's retries, so a retried write is answered from the server's idempotency store (`replayed: true`) instead of running twice. TanStack Query calls the mutation function again with the same variables object on a retry (spike): the front runtime draws the key on the first attempt, keeps it in a `WeakMap` keyed by that object, and drops it when the mutation settles, so the next `mutate` draws a new one. A key the caller passes in the request's headers wins. This is the contract's wire guarantee and has no switch. A mutation restored by a persister after a reload is a new object and draws a new key.

### SWR

`query: swr` renders the same plan in SWR's idiom: `use<Op>(request | null, config?)` over `useSWR`, with `null` for a conditional fetch; `use<Op>Infinite` over `useSWRInfinite`, its keys built by the next-page rule above; `use<Op>` over `useSWRMutation` for the other operations. `<op>Options(request)` returns `{ key, fetcher }` for `preload` and an `SWRConfig` `fallback`. Invalidation calls the bound `mutate` with a filter on the resource segment of the key; since SWR's filters skip infinite keys (spike), the hooks module records the `unstable_serialize` key of each mounted infinite query by resource and revalidates those by key. SWR then refetches the first page and, unless the app sets `revalidateAll`, the pages whose data changed. `staleTime: contract` is refused by name with `query: swr` (`options.staleTime.unsupported`): no SWR option keeps data fresh for a time, `dedupingInterval` only merges requests.

### RTK Query

`query: rtk` generates `create<Api>Api(client, { reducerPath? })` over `createApi` with `fakeBaseQuery`, one `build.query`, `build.infiniteQuery` (RTK 2.6 and later) or `build.mutation` per operation, each `queryFn` calling the client with RTK's `signal`; resource types are the `tagTypes`, queries `providesTags` and mutations `invalidatesTags` (none under `invalidate: off`), and the hooks keep RTK's own names (`useListTasksQuery`). The store holds plain data only: a thrown `queryFn` is serialised by RTK and loses the error's class and fields (spike), so every `queryFn` catches and returns its failure as `{ error }`, a plain value with the `ContractError`'s `operation` and `failure` (headers as a record) or the rejection's `name` and `message`. `staleTime: contract` maps to `refetchOnMountOrArgChange` in seconds. With the `hooks` artefact off, `createApi` comes from `@reduxjs/toolkit/query`, without React.

### Server components

`hooks.ts`, and the RTK module when it has hooks, start with `"use client"`, so a Next.js App Router app imports them from client components; `useClientDirective: off` drops the directive for a toolchain that rejects it. `queries.ts` stays server-safe: a server component prefetches with `queryClient.prefetchQuery(Tasks.listTasksOptions(request))` over a server client and passes `dehydrate(queryClient)` down, and the browser's hooks read the same keys. The e2e app is a Vite single-page app; a Next.js example joins the examples after this lane.

### Options, artefacts and their defaults

| Setting | Values | Default | What it turns off |
|---|---|---|---|
| `query` | `tanstack`, `swr`, `rtk` | required | (no default library) |
| `errors` | `throw`, `data` | `throw` | errors in the library's error state |
| `invalidate` | `resource`, `off` | `resource` | refresh after a write |
| `staleTime` | `off`, `contract` | `off` | (opt-in freshness) |
| `infinite` | `on`, `off` | `on` | infinite queries |
| `useClientDirective` | `on`, `off` | `on` | the `"use client"` line |
| `keys.root` | string | the api name | (renames the first key segment) |
| `artefacts.hooks` | boolean | `true` | the `use*` hooks; options factories and keys stay |
| `artefacts.itemsOf` | boolean | `false` | (opt-in `itemsOf` export) |

An unknown option key or value is refused by name (`options.unknown`, `options.<key>.invalid`), as `codegen-fetch` does; a missing `query` is `options.query.missing`. The idempotency key per mutation is the only behaviour without a switch.

### Matrix and dependencies

The compatibility matrix gains the `client` link with its style `fetch`, provided by `codegen-fetch`, and for `codegen-react` React 19, `@tanstack/react-query` 5 (5.90 or later: the mutation callbacks' context carries the `QueryClient`), `swr` 2, and `@reduxjs/toolkit` 2 (2.6 or later, for infinite queries) with `react-redux` 9, each tested by its consumer; React 18 is recorded untested, a warning (ADR 0009). The library chosen by `query` and React are peer dependencies; the generated code imports the linked client, the front runtime copy, and that library only.

### Refused by name or waiting

Refused by name: a missing or mismatched `client` link; an operation the client leaves out; `errors: data` with a `throw`-style client; `staleTime: contract` with SWR; two exports with one name; a missing `query` and any unknown option. Warned by name: a paged operation that gets no infinite query.

Waiting, each refused or absent by name until a consumer needs it: the previous page (`getPreviousPageParam`); optimistic updates; `If-None-Match` sent by the hooks, since the browser's HTTP cache already revalidates ETags; a retry policy read from the contract (no retry on a declared client error, `Retry-After` as the delay), the library's default and the app's `retry` applying meanwhile; RTK's `injectEndpoints` into an app's own api; prefetch helpers beyond the options factories; a Next.js end-to-end app.

### The end-to-end proof and the consumer harness

A consumer is the template plus a chain of overlays of any depth, each naming its base, checked acyclic: `react-tanstack` on `react` on `front` on `hono`. The `front` overlay adds a Vitest browser project on Playwright Chromium beside the node project, whose Vitest config starts the `hono` overlay's server with a top-level `await`, so its URL is known when Vite reads `server.proxy` without relying on when global setup runs, proxies the api's base path to it, so the client's `baseUrl` is the page's origin, and provides the server's URL to the tests; a script loader drives the server's control routes. The `react` overlay is a Vite React 19 app with its own `tsconfig.json` (`jsx: react-jsx`); each library overlay holds its app and its `test/front/*.browser.test.tsx`, rendered with `vitest-browser-react`. Every react consumer also runs `seampact generate` then `check`, a consumer `tsc` over `test/front/typed.check.tsx` (an undeclared error code and a missing required `timeoutMs` are `@ts-expect-error`), and a `vite build`.

The browser tests, each through the generated client and hooks against the real server: 1 a list renders; 2 an infinite cursor list loads three pages and ends, and a page style on a Laravel-pack tree; 3 a create refreshes the list, which stays stale under `invalidate: off`; 4 `api.rate_limited` with its `retryAfterMs` shown for a throttled token; 5 an unmount aborts the request; 6 a dropped first answer and one retry send one idempotency key, the second answer `replayed: true`; 7 caller options pass through (`enabled: false` sends nothing, `select` applies, a `queryKey` wins); 8 `errors: data`. SWR runs 1 to 4, 6 and 7, RTK 1 to 7. The node project still runs the `hono` overlay's http-suite profiles unchanged: the suite is black-box HTTP and the hooks add no wire behaviour.

### Delivery

- PR 1, the seam the other front lanes wait on: the `client` link kind and descriptor, `codegen-fetch` providing it, the overlay chain of any depth, the `front` overlay and a `front-fetch` consumer that drives the fetch client in a browser against Hono (a list, a create, a declared error, an abort, header page facts), its CI workflow, and the matrix entries.
- PR 2: the query plan and the front runtime in codegen-core, `@seampact/codegen-react` with its options parser and the TanStack renderer, and the `react` and `react-tanstack` overlays with tests 1 to 8.
- PR 3: the SWR and RTK renderers with the `react-swr` and `react-rtk` overlays, split in two PRs if it grows past one deliverable.

## Spike

Run on Node 24.21 with `@tanstack/query-core` 5.90.3, `@reduxjs/toolkit` 2.11.0, `swr` 2.5.1, React 19.3.1, Vitest 5.0.3 with `@vitest/browser-playwright` 5.0.3 on Playwright 1.64.1 Chromium headless shell, and `vitest-browser-react` 2.3.0; not kept.

| Case | Result |
|---|---|
| TanStack mutation with `retry: 1`, first attempt failing | the mutation function ran twice with the caller's variables object; a key kept in a `WeakMap` by it was the same on both attempts |
| TanStack mutation `onSuccess` fourth argument | `{ client, meta, mutationKey }`, `client` the `QueryClient` |
| TanStack infinite query over cursor facts | three pages, `hasNextPage` false after the last; the `signal` reached the query function |
| TanStack `invalidateQueries` on `[api, { resource }]` | the list key below it invalidated; a request member `undefined` hashed as absent |
| RTK `fakeBaseQuery` query, then a mutation invalidating its tag | the query refetched; `queryFn` received an `AbortSignal` |
| RTK `queryFn` that throws | the error stored as a serialised `{ name, message, stack }`, logged as unhandled |
| RTK data holding `Headers`, error holding an `Error` subclass | serialisability warnings on the action and the state |
| RTK `build.infiniteQuery` | two pages, `hasNextPage` false |
| Vitest browser mode, `server.proxy` to a Node server started in the config | same-origin `fetch('/api/...')` reached the server with its path; `X-Total-Count`, `Link` and `Retry-After` readable; the URL provided to the test |
| the same server started by global setup, the proxy target a getter over the URL it set | passed: Vite read the target after global setup ran, an ordering Vitest does not document |
| SWR filter `mutate` on the resource segment | the plain list refetched; the infinite pages did not |
| SWR `mutate(unstable_serialize(getKey))` | the infinite query refetched its first page |

## Consequences

- An app keeps its own `QueryClient`, SWR config or Redux store, its providers and its library defaults; the generated code adds queries, keys and an invalidation it can turn off, and every library option passes through.
- Query data differs from the fetch client's result in one place: `headers` is a plain record. An RTK error is a plain value, not a `ContractError` instance.
- A retried mutation of an idempotent operation is not run twice by the server; no setting changes that.
- A paged list whose style gives no next position has a plain query and a warning, not an infinite query.
- The front targets share the query plan, the front runtime and the browser harness, so Vue renders the same keys, invalidation and paging, and the MSW target's tests run in the same browser project.
- Each react consumer adds Playwright Chromium to its CI row.

## Traceability

- FRs: FR-14 (a case refused by name), FR-15 (the typed client underneath), FR-19 (front-end clients), FR-39 (the provider seam); amendments A6, A30, A31, A36, A37, A47.
- ADRs: 0002 grammar 14 (paging roles), 0004 (the operation's `safe`, `resource`, `paging`, `idempotency`, `cache`), 0007 (names, generated modules), 0009 (links, artefacts, the matrix), 0011 (unpublished installs for test consumers), 0015 (pinned formatting), 0020 (the Hono server the e2e runs against).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate of each react consumer.

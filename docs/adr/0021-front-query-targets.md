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

Each section lives in its own file under the folder named like this ADR, in the order of the table.

| Section | File |
|---|---|
| The client link | [0021-front-query-targets/01-the-client-link.md](0021-front-query-targets/01-the-client-link.md) |
| The shared query plan and front runtime | [0021-front-query-targets/02-the-shared-query-plan-and.md](0021-front-query-targets/02-the-shared-query-plan-and.md) |
| The generated API | [0021-front-query-targets/03-the-generated-api.md](0021-front-query-targets/03-the-generated-api.md) |
| Keys | [0021-front-query-targets/04-keys.md](0021-front-query-targets/04-keys.md) |
| Data and errors | [0021-front-query-targets/05-data-and-errors.md](0021-front-query-targets/05-data-and-errors.md) |
| Invalidation and freshness | [0021-front-query-targets/06-invalidation-and-freshness.md](0021-front-query-targets/06-invalidation-and-freshness.md) |
| Paged lists | [0021-front-query-targets/07-paged-lists.md](0021-front-query-targets/07-paged-lists.md) |
| Abort, timeouts and idempotency | [0021-front-query-targets/08-abort-timeouts-and-idempotency.md](0021-front-query-targets/08-abort-timeouts-and-idempotency.md) |
| SWR | [0021-front-query-targets/09-swr.md](0021-front-query-targets/09-swr.md) |
| RTK Query | [0021-front-query-targets/10-rtk-query.md](0021-front-query-targets/10-rtk-query.md) |
| Plain fetch | [0021-front-query-targets/11-plain-fetch.md](0021-front-query-targets/11-plain-fetch.md) |
| Server components | [0021-front-query-targets/12-server-components.md](0021-front-query-targets/12-server-components.md) |
| Vue | [0021-front-query-targets/13-vue.md](0021-front-query-targets/13-vue.md) |
| Angular | [0021-front-query-targets/14-angular.md](0021-front-query-targets/14-angular.md) |
| MSW | [0021-front-query-targets/15-msw.md](0021-front-query-targets/15-msw.md) |
| Options, artefacts and their defaults | [0021-front-query-targets/16-options-artefacts-and-their-defaults.md](0021-front-query-targets/16-options-artefacts-and-their-defaults.md) |
| Matrix and dependencies | [0021-front-query-targets/17-matrix-and-dependencies.md](0021-front-query-targets/17-matrix-and-dependencies.md) |
| Refused by name or waiting | [0021-front-query-targets/18-refused-by-name-or-waiting.md](0021-front-query-targets/18-refused-by-name-or-waiting.md) |
| The end-to-end proof and the consumer harness | [0021-front-query-targets/19-the-end-to-end-proof.md](0021-front-query-targets/19-the-end-to-end-proof.md) |
| Delivery | [0021-front-query-targets/20-delivery.md](0021-front-query-targets/20-delivery.md) |

## Spike

Run on Node 24.21 with `@tanstack/query-core` 5.90.3, `@reduxjs/toolkit` 2.11.0, `swr` 2.5.1, React 19.3.1, Vitest 5.0.3 with `@vitest/browser-playwright` 5.0.3 on Playwright 1.64.1 Chromium headless shell, and `vitest-browser-react` 2.3.0; not kept.

| Case | Result |
|---|---|
| TanStack mutation with `retry: 1`, first attempt failing | the mutation function ran twice with one `MutationFunctionContext`; a key kept in a `WeakMap` by it was the same on both attempts and new on the next `mutate(undefined)`; a `WeakMap` keyed by `undefined` variables throws |
| TanStack mutation `onSuccess` fourth argument | `{ client, meta, mutationKey }`, `client` the `QueryClient` |
| TanStack `fetchQuery` then `fetchInfiniteQuery` on one key | one cache entry, the infinite read returned the plain data with no `pages` |
| RTK 2.11 query hooks | unsubscribe on unmount and arg change, never abort; `refetchOnMountOrArgChange` only on `createApi`, hooks and `initiate` |
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
- Query data differs from the fetch client's result in one place: `headers` is a plain record. An RTK error is a plain value, not a `ContractError` instance; both are library constraints.
- RTK Query neither aborts on unmount nor retries mutations, SWR neither aborts a query nor retries mutations, and both refuse `staleTime: contract`; each limit is named in its section.
- A retried mutation of an idempotent operation is not run twice by the server; no setting changes that.
- A paged list whose style gives no next position has a plain query and a warning, not an infinite query.
- The front targets share the query plan, the front runtime and the browser harness, so Vue renders the same keys, invalidation and paging, and the MSW target's tests run in the same browser project.
- Each react consumer adds Playwright Chromium to its CI row.

## Traceability

- FRs: FR-14 (a case refused by name), FR-15 (the typed client underneath), FR-19 (front-end clients), FR-39 (the provider seam); amendments A6, A30, A31, A36, A37, A47.
- ADRs: 0002 grammar 14 (paging roles), 0004 (the operation's `safe`, `resource`, `paging`, `idempotency`, `cache`), 0007 (names, generated modules), 0009 (links, artefacts, the matrix), 0011 (unpublished installs for test consumers), 0015 (pinned formatting), 0020 (the Hono server the e2e runs against).
- Proof in the development phase: the review of this ADR, the spike above, and the end-to-end gate of each react consumer.

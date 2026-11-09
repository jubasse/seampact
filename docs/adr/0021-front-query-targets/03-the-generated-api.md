### The generated API

Per api, two modules, re-exported by the api's `index.ts` (ADR 0007 section 7):

- `queries.ts`, server-safe: `create<Api>Queries(client, settings?)` returns `keys` and, per `safe` operation, `<op>Options(request, options?)` (`queryOptions`), plus `<op>InfiniteOptions(request, options?)` (`infiniteQueryOptions`) for a paged one, and per other operation `<op>MutationOptions(options?)` (`mutationOptions`). It holds no `"use client"` directive and imports no React hook, so a server component prefetches with it.
- `hooks.ts`, starting with `"use client"`: `create<Api>Hooks(client, settings?)` returns the same members plus `use<Op>(request, options?)` over `useQuery`, `use<Op>Infinite` over `useInfiniteQuery`, and `use<Op>(options?)` over `useMutation`.

```ts
const Tasks = createTasksHooks(client);

const tasks = Tasks.useListTasks({ query: { limit: 20 } });
const create = Tasks.useCreateTask();
const first = useSuspenseQuery(Tasks.listTasksOptions({ query: { limit: 20 } }));
```

The caller's options are spread after the generated ones, so every library option applies (`enabled`, `select`, `retry`, `staleTime`, `placeholderData`); only `queryFn` and `mutationFn` stay generated, and a caller's `queryKey` wins. `onSuccess` on a mutation is the one composed option: the generated invalidation runs first, then the caller's `onSuccess`, so a spread never drops the invalidation. `options.call` passes the client's call options (`timeoutMs`); it is required, with `timeoutMs`, for an operation whose client method requires a timeout. `settings.idempotencyKey` replaces `crypto.randomUUID` as the key generator, as the client config's own does; a platform without either is refused when the factory is called, with that fix. The docs bind the result to a PascalCase name (`Tasks`), which the React hooks lint rule reads as a namespace of hooks.

### Invalidation and freshness

A mutation's success invalidates `keys.resource(<its resource type>)` before it runs the caller's `onSuccess`; an operation without a resource invalidates nothing. In TanStack Query the generated `onSuccess` reads the `QueryClient` from the mutation callbacks' context, so the factory takes none; it returns the `invalidateQueries` promise, so `isPending` lasts until the refetch ends, as TanStack recommends. `invalidate: off` drops it.

Under `staleTime: contract`, a query's `staleTime` is the operation's `cache.directives.maxAgeMs`, and 0 for an operation with `noStore`, `noCache` or no directives; without it the library's own default applies.

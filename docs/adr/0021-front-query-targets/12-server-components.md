### Server components

`hooks.ts`, and the RTK module when it has hooks, start with `"use client"`, so a Next.js App Router app imports them from client components; `useClientDirective: off` drops the directive for a toolchain that rejects it. `queries.ts` stays server-safe: a server component prefetches with `queryClient.prefetchQuery(Tasks.listTasksOptions(request))` over a server client and passes `dehydrate(queryClient)` down, and the browser's hooks read the same keys. The e2e app is a Vite single-page app; a Next.js example joins the examples after this lane.

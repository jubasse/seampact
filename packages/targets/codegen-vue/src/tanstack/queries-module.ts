import {
  type QueriesImports,
  type QueryPlan,
  type TanstackAdapter,
  tanstackQueriesModuleSource,
} from "@seampact/codegen-core";
import type { VueQueryOptions } from "../options.js";

// The `queries.ts` of one api for TanStack Query (ADR 0021 "The generated API"), shared with the other front
// targets. The caller options are built on Vue Query's plain option types, which `queryOptions` and its siblings
// take; a reactive request or option goes through the composables' getters. Vue Query unwraps the refs of a key
// type, which its `readonly unknown[]` key does not survive, so the module declares the key segments it uses; the
// infinite caller options leave out `initialData`, whose union the infinite overloads refuse.

const VUE_QUERY: TanstackAdapter = {
  module: "@tanstack/vue-query",
  queryOptionsType: "QueryOptions",
  infiniteQueryOptionsType: "InfiniteQueryObserverOptions",
  mutationOptionsType: "MutationOptions",
  entryPoints: "`useQuery`, `useInfiniteQuery`, `prefetchQuery`",
  queryOptionsTrailingArguments: ', Operation["data"], QueryKey',
  infiniteCallerOmissions: ["initialData"],
  queryKeySource:
    "/** A query key: the root, the resource, the operation id and the key request, or the caller's own segments. */\nexport type QueryKey = readonly (string | Readonly<Record<string, unknown>> | undefined)[];",
};

/** The source of `queries.ts`. */
export function queriesModuleSource(
  plan: QueryPlan,
  options: VueQueryOptions,
  root: string,
  imports: QueriesImports,
): string {
  return tanstackQueriesModuleSource(plan, options, root, imports, VUE_QUERY);
}

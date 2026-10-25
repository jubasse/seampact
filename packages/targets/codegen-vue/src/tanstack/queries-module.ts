import {
  type QueriesImports,
  type QueryPlan,
  type TanstackAdapter,
  tanstackQueriesModuleSource,
} from "@seampact/codegen-core";
import type { VueQueryOptions } from "../options.js";

// The `queries.ts` of one api for TanStack Query (ADR 0021 "The generated API"), shared with the other front
// targets. The caller options are built on Vue Query's plain option types, which `queryOptions` and its siblings
// take; a reactive request or option goes through the composables' getters.

const VUE_QUERY: TanstackAdapter = {
  module: "@tanstack/vue-query",
  queryOptionsType: "QueryOptions",
  infiniteQueryOptionsType: "InfiniteQueryObserverOptions",
  mutationOptionsType: "MutationOptions",
  entryPoints: "`useQuery`, `useInfiniteQuery`, `prefetchQuery`",
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

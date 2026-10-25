import {
  type QueriesImports,
  type QueryPlan,
  type TanstackAdapter,
  tanstackQueriesModuleSource,
} from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";

// The server-safe `queries.ts` of one api for TanStack Query (ADR 0021 "The generated API"), shared with the other
// front targets: it holds no `"use client"` and imports no hook, so a server component prefetches with it.

const REACT_QUERY: TanstackAdapter = {
  module: "@tanstack/react-query",
  queryOptionsType: "UseQueryOptions",
  infiniteQueryOptionsType: "UseInfiniteQueryOptions",
  mutationOptionsType: "UseMutationOptions",
  entryPoints: "`useQuery`, `useSuspenseQuery`, `prefetchQuery`",
};

/** The source of `queries.ts`. */
export function queriesModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  root: string,
  imports: QueriesImports,
): string {
  return tanstackQueriesModuleSource(plan, options, root, imports, REACT_QUERY);
}

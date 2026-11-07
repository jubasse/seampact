import {
  fetchQueriesModuleSource,
  type QueriesImports,
  type QueryPlan,
} from "@seampact/codegen-core";
import type { ReactQueryOptions } from "../options.js";

// The server-safe `queries.ts` of one api for plain fetch (ADR 0021 "Plain fetch"), shared with the other front
// targets: it has no keys and imports no React, so a server component reads its data with it.

/** The source of `queries.ts`. */
export function queriesModuleSource(
  plan: QueryPlan,
  options: ReactQueryOptions,
  imports: QueriesImports,
): string {
  return fetchQueriesModuleSource(plan, options, imports);
}

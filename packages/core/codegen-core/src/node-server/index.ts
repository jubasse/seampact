// The shared Node server boundary every Node server target generates (ADR 0016): the framework-neutral runtime
// copied into the generated tree, and the emitters of the route table, handler interfaces and hook types.
import { readdirSync, readFileSync } from "node:fs";
import type { GeneratedFile } from "../target.js";

export { type RouteTableOptions, routeTableSource } from "./route-table.js";
export { handlersSource, hookTypesSource, operationIdentifier } from "./server-types.js";

/** The directory, under an api's output, that holds the copied runtime. */
export const NODE_SERVER_RUNTIME_DIRECTORY = "node-server";

// The runtime lives in this package as checked sources, two directories above both `src/node-server` and
// `dist/node-server`, so the published package ships them (`files`).
const RUNTIME_SOURCE_URL = new URL("../../src/node-server/runtime/", import.meta.url);
const SOURCE_SUFFIX = ".ts";

/** Every runtime module, copied as is under `node-server/`. */
export function nodeServerRuntimeFiles(): GeneratedFile[] {
  return readdirSync(RUNTIME_SOURCE_URL)
    .filter((name) => name.endsWith(SOURCE_SUFFIX))
    .sort()
    .map((name) => ({
      path: `${NODE_SERVER_RUNTIME_DIRECTORY}/${name}`,
      contents: readFileSync(new URL(name, RUNTIME_SOURCE_URL), "utf8"),
    }));
}

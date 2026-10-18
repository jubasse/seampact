import { readdirSync, readFileSync } from "node:fs";
import type { GeneratedFile } from "../target.js";

/** The directory, under an api's output, that holds the copied runtime. */
export const NODE_SERVER_RUNTIME_DIRECTORY = "node-server";

// The runtime lives in this package as sources two directories above both `src/node-server` and
// `dist/node-server`, shipped by `files`; the targets' compile tests type-check it in a generated tree.
const RUNTIME_SOURCE_URL = new URL("../../node-server-runtime/", import.meta.url);
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

import { readFileSync } from "node:fs";
import type { GeneratedFile } from "../target.js";

/** The module name, beside the generated queries, of the copied front runtime. */
export const FRONT_RUNTIME_MODULE = "query-runtime";

// The runtime lives in this package as a source two directories above both `src/front-queries` and
// `dist/front-queries`, shipped by `files`; the front consumers type-check it in their generated tree.
const RUNTIME_SOURCE_URL = new URL("../../front-runtime/query-runtime.ts", import.meta.url);

/** The front runtime, copied as is beside the generated queries. */
export function frontRuntimeFile(): GeneratedFile {
  return { path: `${FRONT_RUNTIME_MODULE}.ts`, contents: readFileSync(RUNTIME_SOURCE_URL, "utf8") };
}

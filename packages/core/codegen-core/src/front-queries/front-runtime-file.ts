import { readFileSync } from "node:fs";
import type { GeneratedFile } from "../target.js";

/** The module name, beside the generated queries, of the copied front runtime. */
export const FRONT_RUNTIME_MODULE = "query-runtime";

/** The suffix of a relative import between generated front modules. */
export const FRONT_MODULE_SUFFIX = ".js";

/** How a generated front module imports the copied front runtime. */
export const FRONT_RUNTIME_SPECIFIER = `./${FRONT_RUNTIME_MODULE}${FRONT_MODULE_SUFFIX}`;

/** The front runtime types every generated front module of a framework re-exports. */
export const FRONT_RUNTIME_TYPE_NAMES: readonly string[] = ["PlainHeaders", "WithPlainHeaders"];

// The runtime lives in this package as a source two directories above both `src/front-queries` and
// `dist/front-queries`, shipped by `files`; the front consumers type-check it in their generated tree.
const RUNTIME_SOURCE_URL = new URL("../../front-runtime/query-runtime.ts", import.meta.url);

/** The front runtime, copied as is beside the generated queries. */
export function frontRuntimeFile(): GeneratedFile {
  return { path: `${FRONT_RUNTIME_MODULE}.ts`, contents: readFileSync(RUNTIME_SOURCE_URL, "utf8") };
}

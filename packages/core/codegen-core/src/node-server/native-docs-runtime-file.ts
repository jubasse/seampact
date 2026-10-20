import { readFileSync } from "node:fs";
import type { GeneratedFile } from "../target.js";

// The guards of the framework's own document, a checked source two directories above both `src/node-server` and
// `dist/node-server`, shipped by `files`; copied only when `nativeDocs` is on.
const RUNTIME_SOURCE_URL = new URL("../../native-docs-runtime/contract-document.ts", import.meta.url);

/** The directory, under an api's output, that holds the copied guards. */
export const NATIVE_DOCS_RUNTIME_DIRECTORY = "native-docs";

export function nativeDocsRuntimeFile(): GeneratedFile {
  return {
    path: `${NATIVE_DOCS_RUNTIME_DIRECTORY}/contract-document.ts`,
    contents: readFileSync(RUNTIME_SOURCE_URL, "utf8"),
  };
}

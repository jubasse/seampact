import { readFileSync } from "node:fs";

// The runtime the generated handlers call, written beside them as is: it lives in this package as a checked source
// file, one directory above both `src` and the built `dist`.
const RUNTIME_SOURCE_URL = new URL("../runtime/mock-runtime.ts", import.meta.url);

export function runtimeModuleSource(): string {
  return readFileSync(RUNTIME_SOURCE_URL, "utf8");
}

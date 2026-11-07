import { readdirSync, readFileSync } from "node:fs";
import type { GeneratedFile } from "@seampact/codegen-core";

// The runtime lives in this package as sources one directory above both `src` and `dist`, shipped by `files`.
const RUNTIME_SOURCE_URL = new URL("../validator-runtime/", import.meta.url);
const SOURCE_SUFFIX = ".ts";

// The constraints, strict options and adapter modules, copied as is at the root of the generated tree.
export function validatorRuntimeFiles(): GeneratedFile[] {
  return readdirSync(RUNTIME_SOURCE_URL)
    .filter((name) => name.endsWith(SOURCE_SUFFIX))
    .sort()
    .map((name) => ({
      path: name,
      contents: readFileSync(new URL(name, RUNTIME_SOURCE_URL), "utf8"),
    }));
}

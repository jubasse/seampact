import { readFileSync } from "node:fs";

export const AXIOS_MODULE = "axios";

// The adapter the generated client imports, written beside it as is: a checked source file one directory above both
// `src` and the built `dist`.
const ADAPTER_SOURCE_URL = new URL("../runtime/axios-fetch.ts", import.meta.url);

export function axiosModuleSource(): string {
  return readFileSync(ADAPTER_SOURCE_URL, "utf8");
}

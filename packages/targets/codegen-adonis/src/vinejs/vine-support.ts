import { readFileSync } from "node:fs";

// The generated module the VineJS validators share: a checked source of this package, one directory above both `src`
// and `dist`, read when an api is generated.
export const VINE_SUPPORT_MODULE = "vine-support";

export const VINE_STANDARD_SCHEMA = "vineStandardSchema";

export const VINE_SUPPORT_SOURCE = readFileSync(
  new URL("../../runtime/vine-support.ts", import.meta.url),
  "utf8",
);

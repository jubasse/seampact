import { readdirSync, readFileSync } from "node:fs";
import type { GeneratedFile } from "../target.js";

/** The modules of the shared server runtime a target copies: the Node targets' or the Web-standard targets'. */
export type ServerRuntimeProfile = "node" | "web";

/** The directory, under an api's output, that holds the copied runtime of each profile. */
export const SERVER_RUNTIME_DIRECTORIES: Readonly<Record<ServerRuntimeProfile, string>> = {
  node: "node-server",
  web: "web-server",
};

/** The directory, under an api's output, that holds the copied runtime of the Node targets. */
export const NODE_SERVER_RUNTIME_DIRECTORY = SERVER_RUNTIME_DIRECTORIES.node;

// A module named with a profile's prefix belongs to that profile only; every other module is neutral and copied by
// both profiles.
const PROFILE_MODULE_PREFIXES: Readonly<Record<ServerRuntimeProfile, string>> = {
  node: "node-",
  web: "web-",
};

// The runtime lives in this package as sources two directories above both `src/node-server` and
// `dist/node-server`, shipped by `files`; the targets' compile tests type-check it in a generated tree.
const RUNTIME_SOURCE_URL = new URL("../../node-server-runtime/", import.meta.url);
const SOURCE_SUFFIX = ".ts";

/** The neutral runtime modules and the profile's own, copied as is under the profile's directory. */
export function nodeServerRuntimeFiles(profile: ServerRuntimeProfile): GeneratedFile[] {
  return readdirSync(RUNTIME_SOURCE_URL)
    .filter((name) => name.endsWith(SOURCE_SUFFIX) && belongsToProfile(name, profile))
    .sort()
    .map((name) => ({
      path: `${SERVER_RUNTIME_DIRECTORIES[profile]}/${name}`,
      contents: readFileSync(new URL(name, RUNTIME_SOURCE_URL), "utf8"),
    }));
}

function belongsToProfile(moduleName: string, profile: ServerRuntimeProfile): boolean {
  const owner = Object.entries(PROFILE_MODULE_PREFIXES).find(([, prefix]) =>
    moduleName.startsWith(prefix),
  );

  return owner === undefined || owner[0] === profile;
}

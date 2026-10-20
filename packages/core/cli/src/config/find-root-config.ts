import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { APP_CONFIG_FILE_NAME, ROOT_CONFIG_MARKER_KEY } from "@seampact/spec/config";
import type { CliProblem } from "../cli-problem.js";
import { isRecord } from "../is-record.js";
import { fileSize, parseConfigFile } from "./config-file.js";
import { type LoadedRootConfig, readRootConfig } from "./read-root-config.js";

// The directory that ends the search for a root config: a repository's top, the first one holding `.git`.
const REPOSITORY_MARKER = ".git";

export type RootDiscovery =
  | { status: "none" }
  | { status: "found"; root: LoadedRootConfig; listed: boolean }
  | { status: "refused"; problems: CliProblem[] };

// The app's root config: the nearest `seampact.config.yaml` holding `apps` that lists the app, above the app's
// directory, searched up to the first directory holding `.git` (else the filesystem root). When no root lists the
// app, the nearest root found comes back with `listed: false`: the app stands alone (ADR 0011 "The app config").
// Every ancestor `seampact.config.yaml` is parsed, so one with a YAML error refuses the app, naming that file.
export async function findRootConfig(
  appFile: string,
  appDisplayName: string,
): Promise<RootDiscovery> {
  const appDirectory = dirname(appFile);
  let nearestUnlisting: RootDiscovery | undefined;

  if (existsSync(join(appDirectory, REPOSITORY_MARKER))) return { status: "none" };

  for (let directory = dirname(appDirectory); ; directory = dirname(directory)) {
    const candidate = join(directory, APP_CONFIG_FILE_NAME);
    const displayName = join(dirname(appDisplayName), relative(appDirectory, candidate));
    const found = await rootConfigAt(candidate, displayName, appDirectory);

    if (found !== undefined && (found.status !== "found" || found.listed)) return found;

    nearestUnlisting ??= found;

    if (existsSync(join(directory, REPOSITORY_MARKER)) || dirname(directory) === directory) {
      return nearestUnlisting ?? { status: "none" };
    }
  }
}

// The root config at `file` when the file holds `apps`; undefined when there is no file or it is an app config.
async function rootConfigAt(
  file: string,
  displayName: string,
  appDirectory: string,
): Promise<RootDiscovery | undefined> {
  if ((await fileSize(file)) === undefined) return undefined;

  const parsed = await parseConfigFile(file, displayName, "root config");

  if (parsed.status === "refused") return parsed;

  if (!isRecord(parsed.value) || !Object.hasOwn(parsed.value, ROOT_CONFIG_MARKER_KEY)) {
    return undefined;
  }

  const read = await readRootConfig(file, displayName);

  if (read.status === "refused") return read;

  const listed = read.config.apps.some((app) => app.directory === appDirectory);

  return { status: "found", root: read.config, listed };
}

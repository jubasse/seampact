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

// The app's root config: the nearest `seampact.config.yaml` holding `apps` above the app's directory, searched up
// to the first directory holding `.git` (else the filesystem root). `listed` is whether its `apps` lists the app;
// an app it does not list stands alone (ADR 0011 "The app config").
export async function findRootConfig(
  appFile: string,
  appDisplayName: string,
): Promise<RootDiscovery> {
  const appDirectory = dirname(appFile);

  if (existsSync(join(appDirectory, REPOSITORY_MARKER))) return { status: "none" };

  for (let directory = dirname(appDirectory); ; directory = dirname(directory)) {
    const candidate = join(directory, APP_CONFIG_FILE_NAME);
    const displayName = join(dirname(appDisplayName), relative(appDirectory, candidate));
    const found = await rootConfigAt(candidate, displayName, appDirectory);

    if (found !== undefined) return found;

    if (existsSync(join(directory, REPOSITORY_MARKER)) || dirname(directory) === directory) {
      return { status: "none" };
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

import { dirname, join } from "node:path";
import { APP_CONFIG_FILE_NAME } from "@seampact/spec/config";
import type { CliProblem } from "../cli-problem.js";
import { type LoadedAppConfig, readListedAppConfig } from "./read-app-config.js";
import { type LoadedRootConfig, readRootConfig, type WorkspaceApp } from "./read-root-config.js";

// A monorepo as its root config describes it: the root, then each app it lists with the root folded in.
export interface LoadedWorkspace {
  root: LoadedRootConfig;
  apps: readonly LoadedWorkspaceApp[];
}

export interface LoadedWorkspaceApp {
  app: WorkspaceApp;
  config: LoadedAppConfig;
}

export type ReadWorkspaceOutcome =
  | { status: "read"; workspace: LoadedWorkspace }
  | { status: "refused"; problems: CliProblem[] };

// Reads the root config and every app it lists; the problems of every app are reported together.
export async function readWorkspaceConfigs(
  rootFile: string,
  displayName: string,
): Promise<ReadWorkspaceOutcome> {
  const root = await readRootConfig(rootFile, displayName);

  if (root.status === "refused") return root;

  const apps: LoadedWorkspaceApp[] = [];
  const problems: CliProblem[] = [];

  for (const app of root.config.apps) {
    const appDisplayName = join(dirname(displayName), app.name, APP_CONFIG_FILE_NAME);
    const read = await readListedAppConfig(app.file, appDisplayName, root.config);

    if (read.status === "refused") problems.push(...read.problems);
    else apps.push({ app, config: read.config });
  }

  if (problems.length > 0) return { status: "refused", problems };

  return { status: "read", workspace: { root: root.config, apps } };
}

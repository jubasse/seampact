import { ROOT_CONFIG_MARKER_KEY } from "@seampact/spec/config";
import type { CliProblem } from "../cli-problem.js";
import { isRecord } from "../is-record.js";
import { parseConfigFile } from "./config-file.js";
import { type LoadedAppConfig, readAppConfig } from "./read-app-config.js";
import { type LoadedWorkspace, readWorkspaceConfigs } from "./read-workspace-configs.js";

// What a command that runs on a config reads: one app, or a monorepo root with each app it lists.
export type RunConfig =
  | { kind: "app"; config: LoadedAppConfig }
  | { kind: "root"; workspace: LoadedWorkspace };

export type ReadRunConfigOutcome =
  | { status: "read"; run: RunConfig }
  | { status: "refused"; problems: CliProblem[] };

// Reads the config file a command runs on: a file holding `apps` is a root config (ADR 0011 "The app config"),
// any other an app config.
export async function readRunConfig(
  file: string,
  displayName: string,
  textFile?: string,
): Promise<ReadRunConfigOutcome> {
  const parsed = await parseConfigFile(textFile ?? file, displayName, "app config");

  if (parsed.status === "refused") return parsed;

  const isRoot = isRecord(parsed.value) && Object.hasOwn(parsed.value, ROOT_CONFIG_MARKER_KEY);

  if (isRoot && textFile !== undefined) {
    return {
      status: "refused",
      problems: [
        {
          code: "cli.app-directory.root",
          message: `${displayName} is a monorepo root config, and \`--app-directory\` reads one app's config.`,
          fix: "Pass a root config with `--config` alone, from the root's directory.",
        },
      ],
    };
  }

  if (isRoot) {
    const workspace = await readWorkspaceConfigs(file, displayName);

    if (workspace.status === "refused") return workspace;

    return { status: "read", run: { kind: "root", workspace: workspace.workspace } };
  }

  const app = await readAppConfig(file, displayName, textFile);

  if (app.status === "refused") return app;

  return { status: "read", run: { kind: "app", config: app.config } };
}

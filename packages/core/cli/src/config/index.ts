// The app config and the monorepo root config as the CLI reads them: the YAML readers and their refusals, the root
// an app belongs to, the OpenAPI documents an app and a root write, and the target packages an app names, resolved
// from the app's own project.

export {
  type MergedContribution,
  type PlannedAppDocument,
  type PlannedMergedDocument,
  openApiSourceNames,
  planAppDocuments,
  planMergedDocuments,
} from "./document-plan.js";
export { type AppConfigEntry, type LoadedAppConfig, readAppConfig } from "./read-app-config.js";
export {
  type LoadedMergedDocument,
  type LoadedRootConfig,
  readRootConfig,
  type WorkspaceApp,
} from "./read-root-config.js";
export {
  type LoadedWorkspace,
  type LoadedWorkspaceApp,
  readWorkspaceConfigs,
} from "./read-workspace-configs.js";
export { resolveTarget } from "./resolve-target.js";

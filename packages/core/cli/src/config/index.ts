// The app config and the monorepo root config as the CLI reads them: the YAML readers and their refusals, the root
// an app belongs to, the OpenAPI documents an app and a root write, the target packages an app names, resolved
// from the app's own project, the artefacts each entry generates and the compatibility matrix check.

export {
  type ArtefactSelection,
  hookCheckLevelOf,
  NATIVE_DOCS_ARTEFACT,
  selectArtefacts,
} from "./artefact-switches.js";
export {
  type CompatibilityInput,
  type CompatibilityOutcome,
  checkAppCompatibility,
  checkCompatibility,
} from "./compatibility-check.js";
export {
  defaultDocumentDirectory,
  type MergedContribution,
  openApiApiNames,
  type PlannedAppDocument,
  type PlannedMergedDocument,
  planAppDocuments,
  planMergedDocuments,
} from "./document-plan.js";
export {
  type InstalledVersion,
  type InstalledVersionOutcome,
  readInstalledVersion,
} from "./installed-version.js";
export { type AppConfigEntry, type LoadedAppConfig, readAppConfig } from "./read-app-config.js";
export {
  type LoadedMergedDocument,
  type LoadedRootConfig,
  readRootConfig,
  type WorkspaceApp,
} from "./read-root-config.js";
export { type ReadRunConfigOutcome, type RunConfig, readRunConfig } from "./read-run-config.js";
export {
  type LoadedWorkspace,
  type LoadedWorkspaceApp,
  readWorkspaceConfigs,
} from "./read-workspace-configs.js";
export { resolveTarget } from "./resolve-target.js";
export type { ResolvedSource } from "./resolved-source.js";

// The app config and the monorepo root config, `seampact.config.yaml` (`@seampact/spec/config`): their types and
// their JSON Schemas.

export {
  APP_CONFIG_FILE_NAME,
  APP_CONFIG_SCHEMA,
  type AppConfig,
  type AppSource,
  type ArtefactSwitches,
  type BundleSource,
  DEFAULT_DIFF_EXEMPTIONS,
  DEFAULT_DIFF_GATE,
  DEFAULT_OUT_DIR,
  DIFF_EXEMPTIONS,
  DIFF_GATE_SCOPES,
  type DiffConfig,
  type DiffExemption,
  type DiffGateScope,
  type GitBundleSource,
  type OperationsFilter,
  type PackageBundleSource,
  type PathSource,
  type ReleaseBundleSource,
  type TargetEntry,
} from "./app-config.js";
export {
  type AppChecks,
  CHECK_LEVELS,
  type CheckLevel,
  MATRIX_CHECK_LEVELS,
  type MatrixCheckLevel,
  type RootChecks,
} from "./checks-config.js";
export {
  type ApiDocumentPlacements,
  type AppOpenApi,
  type DocumentPlacement,
  type ExtensionsOption,
  type MergedDocumentEntry,
  NO_OPENAPI_DOCUMENTS,
  type OpenApiDocumentOptions,
  type OpenApiServer,
  type PlacedDocument,
  type RootOpenApi,
} from "./openapi-config.js";
export {
  APP_ONLY_KEYS,
  ROOT_CONFIG_MARKER_KEY,
  ROOT_CONFIG_SCHEMA,
  type RootConfig,
} from "./root-config.js";

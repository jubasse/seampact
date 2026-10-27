// The shared server boundary every Node and Web-standard server target generates (ADR 0016, ADR 0020): the
// framework-neutral runtime, imported from `@seampact/server-runtime` or still copied into the generated tree, the
// generate-time check of the installed runtime (ADR 0025), the emitters of the route table, handler interfaces and
// hook types, the target options parser, the path segments a router cannot read, and the assembly of one api's
// boundary files around a target's placement.
export {
  BOUNDARY_ARTEFACT,
  type BoundaryArtefact,
  type CopiedRuntimePlacement,
  NATIVE_DOCS_ARTEFACT,
  type NativeDocsPlacement,
  NODE_SERVER_BOOT_CHECKS,
  type NodeServerArtefact,
  type NodeServerPlacement,
  type NodeServerTargetPackage,
  nodeServerBoundaryFiles,
  nodeServerTarget,
  OWN_VALIDATORS_ARTEFACT,
  type OwnValidators,
  type PackagedRuntimePlacement,
} from "./boundary-files.js";
export { handlerMapDeclarations, largestBodyLimit } from "./handler-map-module.js";
export {
  type DocumentedOperation,
  type NativeDocsContract,
  readNativeDocsDocument,
} from "./native-docs-reader.js";
export {
  type CompressionOption,
  type FrameworkEtagMode,
  type NodeServerOptions,
  parseNodeServerOptions,
  type ResponsesMode,
  responseSettingsOf,
} from "./options.js";
export { type OwnValidatorsLibrary, ownValidatorsFiles } from "./own-validators-files.js";
export { pageBodyLocation, pageBodyTemplate } from "./paging-entry.js";
export { literalSegmentRefusals, mixedSegmentRefusals } from "./path-segment-refusals.js";
export { compareRouteSpecificity } from "./route-order.js";
export { type RouteTableOptions, routeTableSource } from "./route-table.js";
export {
  NODE_SERVER_RUNTIME_DIRECTORY,
  neutralRuntimeSpecifier,
  nodeServerRuntimeFiles,
  PACKAGED_RUNTIME,
  SERVER_RUNTIME_DIRECTORIES,
  SERVER_RUNTIME_PACKAGE,
  type ServerRuntimeProfile,
  type ServerRuntimeSource,
} from "./runtime-files.js";
export {
  RUNTIME_MISSING,
  RUNTIME_VERSION_MISMATCH,
  type RuntimeGenerator,
  serverRuntimeRefusals,
} from "./server-runtime-check.js";
export {
  handlerInterfaceName,
  handlersSource,
  hookTypesSource,
  operationIdentifier,
} from "./server-types.js";

// The shared server boundary every Node and Web-standard server target generates (ADR 0016, ADR 0020): the
// framework-neutral runtime copied into the generated tree, the emitters of the route table, handler interfaces and
// hook types, the target options parser, the path segments a router cannot read, and the assembly of one api's
// boundary files around a target's placement.
export {
  BOUNDARY_ARTEFACT,
  type BoundaryArtefact,
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
} from "./boundary-files.js";
export { handlerMapDeclarations, largestBodyLimit } from "./handler-map-module.js";
export {
  type DocumentedOperation,
  type NativeDocsContract,
  readNativeDocsDocument,
} from "./native-docs-reader.js";
export { type OwnValidatorsLibrary, ownValidatorsFiles } from "./own-validators-files.js";
export { type NodeServerOptions, parseNodeServerOptions, type ResponsesMode } from "./options.js";
export { literalSegmentRefusals, mixedSegmentRefusals } from "./path-segment-refusals.js";
export { compareRouteSpecificity } from "./route-order.js";
export { type RouteTableOptions, routeTableSource } from "./route-table.js";
export {
  NODE_SERVER_RUNTIME_DIRECTORY,
  nodeServerRuntimeFiles,
  SERVER_RUNTIME_DIRECTORIES,
  type ServerRuntimeProfile,
} from "./runtime-files.js";
export {
  handlerInterfaceName,
  handlersSource,
  hookTypesSource,
  operationIdentifier,
} from "./server-types.js";

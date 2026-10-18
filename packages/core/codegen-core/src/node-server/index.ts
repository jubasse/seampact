// The shared Node server boundary every Node server target generates (ADR 0016): the framework-neutral runtime
// copied into the generated tree, the emitters of the route table, handler interfaces and hook types, the target
// options parser, and the assembly of one api's boundary files around a target's placement.
export {
  BOUNDARY_ARTEFACT,
  type BoundaryArtefact,
  type NodeServerPlacement,
  type NodeServerTargetPackage,
  nodeServerBoundaryFiles,
  nodeServerTarget,
} from "./boundary-files.js";
export { handlerMapDeclarations, largestBodyLimit } from "./handler-map-module.js";
export { type NodeServerOptions, parseNodeServerOptions, type ResponsesMode } from "./options.js";
export { type RouteTableOptions, routeTableSource } from "./route-table.js";
export { NODE_SERVER_RUNTIME_DIRECTORY, nodeServerRuntimeFiles } from "./runtime-files.js";
export {
  handlerInterfaceName,
  handlersSource,
  hookTypesSource,
  operationIdentifier,
} from "./server-types.js";

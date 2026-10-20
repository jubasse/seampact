// The OpenAPI 3.1 emitter: an api's documents written from the IR through the table of ADR 0004 section 12, the
// emitter options of A40, the drift check of a committed document, and the `x-seampact-*` extension names whose
// JSON Schemas the package publishes.

export { findDocumentDrift, type DocumentDrift } from "./drift.js";
export {
  emitDocuments,
  type EmitOutcome,
  type EmittedDocument,
  OPENAPI_VERSION,
} from "./documents.js";
export {
  ALL_EXTENSIONS,
  DEFAULT_EMITTER_OPTIONS,
  type EmitterOptions,
  type ExtensionSelection,
  type InputSchemasOption,
  NO_EXTENSIONS,
  type ParsedEmitterOptions,
  parseEmitterOptions,
  type ReasonsOption,
  type ServerOption,
} from "./emitter-options.js";
export {
  EXTENSION_NAMES,
  EXTENSION_PREFIX,
  type ExtensionName,
  extensionSchemaPath,
  isExtensionName,
} from "./extension-names.js";

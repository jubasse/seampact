export type * from "./types.generated.js";
export {
  IR_SCHEMA_BASE,
  IR_SCHEMA_DOCUMENTS,
  IR_SCHEMA_ID,
  SOURCE_MAP_SCHEMA_ID,
} from "./schemas.js";
export type { SchemaNode } from "./schemas.js";
export {
  classifyIrErrors,
  IR_AJV_OPTIONS,
  IR_KEYWORDS,
  KNOWN_VALUES_KEYWORD,
  strictIrSchemas,
} from "./validation.js";
export type {
  IrSchemaForm,
  IrSchemaProblem,
  IrUnknownKind,
  IrValidationReport,
  IrValidatorError,
} from "./validation.js";
export { IR_REVISION, IR_VERSION } from "./version.js";

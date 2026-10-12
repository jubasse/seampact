export type * from "./types.generated.js";
export {
  IR_SCHEMA_BASE,
  IR_SCHEMA_DOCUMENTS,
  IR_SCHEMA_ID,
  SOURCE_MAP_SCHEMA_ID,
} from "./schemas.js";
export type { SchemaNode } from "./schemas.js";
export { listIrUnknowns, walkIrInstance } from "./instance-walk.js";
export type { IrInstanceNode, IrUnknowns } from "./instance-walk.js";
export { isKnownVariant } from "./unions.js";
export {
  classifyIrErrors,
  createIrValidator,
  IR_AJV_OPTIONS,
  IR_KEYWORDS,
  KNOWN_VALUES_KEYWORD,
  MUST_ACT_KEYWORD,
  strictIrSchemas,
} from "./validation.js";
export type {
  IrAjv,
  IrAjvConstructor,
  IrAjvValidateFunction,
  IrKeywordDefinition,
  IrSchemaForm,
  IrSchemaProblem,
  IrUnknownKind,
  IrUnknownValue,
  IrValidationReport,
  IrValidator,
  IrValidatorError,
} from "./validation.js";
export { checkIrSupport } from "./support.js";
export type {
  IrSupport,
  IrSupportCode,
  IrSupportInput,
  IrSupportMismatch,
} from "./support.js";
export { IR_REVISION, IR_VERSION } from "./version.js";

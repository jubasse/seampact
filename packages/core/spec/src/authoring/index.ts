// The authoring grammar: the JSON Schemas of the YAML files (ADR 0002), their schema keywords and markers.

export {
  REFUSED_SCHEMA_KEYWORDS,
  SCHEMA_KEYWORDS,
  type SchemaKeyword,
  type SchemaKeywordDecision,
  schemaKeyword,
} from "./keywords.js";
export { DATA, isMarker, MARKERS, type Marker, RESERVED_NAMES } from "./markers.js";
export {
  AUTHORING_FILES,
  type AuthoringFile,
  authoringSchemaFileName,
  authoringSchemas,
  JSON_SCHEMA_DIALECT,
  type JsonSchema,
} from "./schemas.js";

// The workspace's editor schemas that `compile --editor-schemas` writes: the authoring schemas with each name position listing the declared names (grammar section 3).

export { type EditorDeclaration, editorDeclarations } from "./editor-names.js";
export {
  DEFAULT_EDITOR_SCHEMAS_DIRECTORY,
  type EditorSchemasOutcome,
  type EditorSchemasSource,
  writeEditorSchemas,
} from "./write-editor-schemas.js";

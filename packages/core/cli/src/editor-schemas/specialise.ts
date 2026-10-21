import {
  AUTHORING_FILES,
  type AuthoringFile,
  authoringSchemaFileName,
  authoringSchemas,
  type JsonSchema,
} from "@seampact/spec/authoring";
import type { EditorNames } from "./editor-names.js";
import { NAME_POSITIONS, type NamePosition } from "./name-positions.js";

// A schema reference also takes a file (`./schemas/task.yaml#/Task`), which the published pattern still checks.
const FILE_REFERENCE = { pattern: "^\\.\\.?/" } as const;

export interface EditorSchemaFile {
  /** `<kind>.schema.json`, the published file name, so relative `$ref`s and modelines keep working. */
  readonly fileName: string;
  readonly text: string;
}

/**
 * The published authoring schemas, each name position listing the names `names` holds, one file per authoring
 * file in published order; the bytes depend on `names` only.
 */
export function editorSchemaFiles(names: EditorNames): EditorSchemaFile[] {
  const published = authoringSchemas();
  const copies = new Map<AuthoringFile, JsonSchema>(
    AUTHORING_FILES.map((file) => [file, structuredClone(published[file])]),
  );

  for (const position of NAME_POSITIONS) {
    const schema = copies.get(position.file);

    if (schema === undefined) throw new Error(`no authoring schema named ${position.file}`);
    specialise(namePositionNode(schema, position), position, names);
  }

  return AUTHORING_FILES.map((file) => ({
    fileName: authoringSchemaFileName(file),
    text: `${JSON.stringify(copies.get(file), null, 2)}\n`,
  }));
}

/** The schema node a name position points at, checked to still hold the name it was written for. */
export function namePositionNode(schema: JsonSchema, position: NamePosition): JsonSchema {
  let node: unknown = schema;

  for (const segment of position.pointer.split("/").slice(1)) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");

    node = isSchemaObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
  }

  if (!isSchemaObject(node) || !holdsName(node, position))
    throw new Error(
      `the authoring schema ${position.file} holds no ${position.catalogue} name at ${position.pointer}: update NAME_POSITIONS`,
    );

  return node;
}

function holdsName(node: JsonSchema, position: NamePosition): boolean {
  if (position.form === "reference") return node.title === "schema reference";

  return node.$ref === position.holds;
}

function specialise(node: JsonSchema, position: NamePosition, names: EditorNames): void {
  const declared = [...(names.get(position.catalogue) ?? new Map<string, string>())];
  const choices = [...declared, ...Object.entries(position.words ?? {})];

  // An empty enum is refused by strict validators: the position keeps checking keywords only.
  if (choices.length === 0) return;

  const named = {
    enum: choices.map(([name]) => name),
    enumDescriptions: choices.map(([, description]) => description),
  };

  if (position.form === "list") node.items = named;
  else if (position.form === "reference") node.anyOf = [named, FILE_REFERENCE];
  else Object.assign(node, named);
}

function isSchemaObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

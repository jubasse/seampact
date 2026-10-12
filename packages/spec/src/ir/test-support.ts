// Shared by the IR tests only (never exported from `@seampact/spec/ir`): an Ajv 2020 validator wired the way
// `validation.ts` documents, and Biome formatting for the generated types.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { escapePointer, isSchemaNode } from "./schema-walk.js";
import {
  IR_SCHEMA_DOCUMENTS,
  IR_SCHEMA_ID,
  type SchemaNode,
  SOURCE_MAP_SCHEMA_ID,
} from "./schemas.js";
import {
  classifyIrErrors,
  IR_AJV_OPTIONS,
  IR_KEYWORDS,
  type IrSchemaForm,
  KNOWN_VALUES_KEYWORD,
  type IrValidationReport,
  strictIrSchemas,
} from "./validation.js";

export function createAjv(form: IrSchemaForm): Ajv2020 {
  const ajv = new Ajv2020({ ...IR_AJV_OPTIONS });
  for (const keyword of IR_KEYWORDS) ajv.addKeyword(structuredClone(keyword));
  const documents = form === "open" ? IR_SCHEMA_DOCUMENTS : strictIrSchemas();
  for (const document of documents) ajv.addSchema(structuredClone(document));
  return ajv;
}

const validators = { open: createAjv("open"), strict: createAjv("strict") };

export function validateIr(
  value: unknown,
  form: IrSchemaForm,
  schemaId: string = IR_SCHEMA_ID,
): IrValidationReport {
  const validate = validators[form].getSchema(schemaId);
  if (validate === undefined) throw new Error(`no schema ${schemaId}`);
  validate(value);
  return classifyIrErrors(validate.errors, form);
}

export const validateSourceMap = (value: unknown, form: IrSchemaForm): IrValidationReport =>
  validateIr(value, form, SOURCE_MAP_SCHEMA_ID);

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function formatTypeScript(source: string, path: string): string {
  const biome = createRequire(`${REPO_ROOT}package.json`).resolve("@biomejs/biome/bin/biome");
  return execFileSync(process.execPath, [biome, "format", `--stdin-file-path=${path}`], {
    cwd: REPO_ROOT,
    input: source,
    encoding: "utf8",
  });
}

// ---- a schema-guided walk over IR instances -----------------------------------------------------------

const DEFS = new Map<string, SchemaNode>();
for (const document of IR_SCHEMA_DOCUMENTS) {
  for (const [name, def] of Object.entries(document.$defs as Record<string, SchemaNode>))
    DEFS.set(name, def);
}

export const definitionNames = (): string[] => [...DEFS.keys()];

export type InstanceNode =
  | {
      kind: "object";
      pointer: string;
      definition: string | undefined;
      value: Record<string, unknown>;
    }
  | {
      kind: "union";
      pointer: string;
      definition: string;
      tag: string;
      value: Record<string, unknown>;
    }
  | { kind: "openEnum"; pointer: string; known: readonly string[]; value: string };

function resolve(node: SchemaNode): { node: SchemaNode; definition: string | undefined } {
  let definition: string | undefined;
  let current = node;
  while (typeof current.$ref === "string") {
    definition = current.$ref.slice(current.$ref.lastIndexOf("/") + 1);
    const next = DEFS.get(definition);
    if (next === undefined) throw new Error(`no definition ${definition}`);
    current = next;
  }
  return { node: current, definition };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Visits every IR object, union and open-enum value of `value`, read as `schema` (the ContractIR by default).
// Maps and opaque values are data: their entries are walked, never treated as IR objects themselves.
export function walkInstance(
  value: unknown,
  visit: (node: InstanceNode) => void,
  schema: SchemaNode = { $ref: "#/$defs/ContractIR" },
  pointer = "",
): void {
  const { node, definition } = resolve(schema);
  if (isSchemaNode(node.discriminator) && Array.isArray(node.oneOf) && isRecord(value)) {
    const tag = String(node.discriminator.propertyName);
    visit({ kind: "union", pointer, definition: definition ?? "?", tag, value });
    for (const variant of node.oneOf as SchemaNode[]) {
      const resolved = resolve(variant);
      const tagSchema = (resolved.node.properties as Record<string, SchemaNode>)[tag];
      if (tagSchema?.const === value[tag]) walkInstance(value, visit, variant, pointer);
    }
    return;
  }
  if (isSchemaNode(node.properties) && isRecord(value)) {
    visit({ kind: "object", pointer, definition, value });
    const properties = node.properties as Record<string, SchemaNode>;
    for (const [member, child] of Object.entries(value)) {
      const memberSchema = properties[member];
      if (memberSchema !== undefined)
        walkInstance(child, visit, memberSchema, `${pointer}/${escapePointer(member)}`);
    }
    return;
  }
  if (isSchemaNode(node.additionalProperties) && isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      walkInstance(child, visit, node.additionalProperties, `${pointer}/${escapePointer(key)}`);
    }
    return;
  }
  if (node.type === "array" && isSchemaNode(node.items) && Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walkInstance(item, visit, node.items as SchemaNode, `${pointer}/${index}`);
    }
    return;
  }
  const known = node[KNOWN_VALUES_KEYWORD];
  if (Array.isArray(known) && typeof value === "string")
    visit({ kind: "openEnum", pointer, known, value });
}

// Returns a copy of `value` with `change` applied to the node at `pointer`.
export function mutateAt(
  value: unknown,
  pointer: string,
  change: (node: Record<string, unknown>) => void,
): unknown {
  const copy = structuredClone(value);
  const segments = pointer === "" ? [] : pointer.slice(1).split("/").map(unescapePointer);
  let node: unknown = copy;
  for (const segment of segments) node = (node as Record<string, unknown>)[segment];
  change(node as Record<string, unknown>);
  return copy;
}

// Returns a copy of `value` with the string at `pointer` replaced.
export function replaceAt(value: unknown, pointer: string, replacement: string): unknown {
  const at = pointer.lastIndexOf("/");
  const member = unescapePointer(pointer.slice(at + 1));
  return mutateAt(value, pointer.slice(0, at), (parent) => {
    parent[member] = replacement;
  });
}

const unescapePointer = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

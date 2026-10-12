// Shared by the IR tests only (never exported from `@seampact/spec/ir`): the validators `createIrValidator` wires
// with Ajv 2020, and Biome formatting for the generated types.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { type IrInstanceNode, irDefinitionNames, walkIrInstance } from "./instance-walk.js";
import { IR_SCHEMA_DOCUMENTS } from "./schemas.js";
import {
  createIrValidator,
  IR_AJV_OPTIONS,
  IR_KEYWORDS,
  type IrSchemaForm,
  type IrValidationReport,
  strictIrSchemas,
} from "./validation.js";

// A bare Ajv 2020 instance holding the schema files of one form, for the metaschema test.
export function createAjv(form: IrSchemaForm): Ajv2020 {
  const ajv = new Ajv2020({ ...IR_AJV_OPTIONS });
  for (const keyword of IR_KEYWORDS) ajv.addKeyword(structuredClone(keyword));
  for (const document of form === "open" ? IR_SCHEMA_DOCUMENTS : strictIrSchemas())
    ajv.addSchema(structuredClone(document));
  return ajv;
}

const validators = {
  open: createIrValidator(Ajv2020, "open"),
  strict: createIrValidator(Ajv2020, "strict"),
};

export const validateIr = (value: unknown, form: IrSchemaForm): IrValidationReport =>
  validators[form].validate(value);

export const validateSourceMap = (value: unknown, form: IrSchemaForm): IrValidationReport =>
  validators[form].validateSourceMap(value);

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function formatTypeScript(source: string, path: string): string {
  const biome = createRequire(`${REPO_ROOT}package.json`).resolve("@biomejs/biome/bin/biome");
  return execFileSync(process.execPath, [biome, "format", `--stdin-file-path=${path}`], {
    cwd: REPO_ROOT,
    input: source,
    encoding: "utf8",
  });
}

export const definitionNames = irDefinitionNames;
export type InstanceNode = IrInstanceNode;
export const walkInstance = (value: unknown, visit: (node: IrInstanceNode) => void): void =>
  walkIrInstance(value, visit);

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

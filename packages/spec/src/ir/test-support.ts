// Shared by the IR tests only (never exported from `@seampact/spec/ir`): an Ajv 2020 validator wired the way
// `validation.ts` documents, and Biome formatting for the generated types.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { IR_SCHEMA_DOCUMENTS, IR_SCHEMA_ID, SOURCE_MAP_SCHEMA_ID } from "./schemas.js";
import {
  classifyIrErrors,
  IR_AJV_OPTIONS,
  IR_KEYWORDS,
  type IrSchemaForm,
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

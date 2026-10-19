import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { JsonObject, LoadedApi } from "./compiler.ts";

// The validator agreement table (ADR 0015 "The validator agreement table"): the rows, the contract they name and
// the checks that keep the two in step. The verdicts are written from ADR 0003; the TypeScript validator lanes
// prove them.

export const AGREEMENT_DIRECTORY = "fixtures/validator-agreement";
export const AGREEMENT_ENTRY = "api.yaml";

// The cases ADR 0015 lists besides those of ADR 0003.
export const ADR_0015_CASES = [
  "root-union-input",
  "per-subtree-unknown-keys",
  "optional-not-nullable-null",
  "variation-selector-length",
  "empty-object-for-list",
  "empty-array-for-object",
  "integer-as-float",
  "optional-nullable-empty-object",
  "nine-digit-fraction",
  "unknown-keys-ignore",
  "unknown-keys-keep",
  "opaque-value",
];

// The ADR 0003 cases the shared payload table holds (sections 2, 8 and 9).
export const ADR_0003_CASES = ["format-boundaries", "portable-patterns", "recursive-schema"];

export interface AgreementRow {
  id: string;
  case?: string;
  schema: string;
  direction: "input" | "output";
  payload?: unknown;
  payloadText?: string;
  expected: "accept" | "reject";
  rule: string;
  received?: unknown;
}

export interface AgreementFiles {
  table: unknown;
  tableSchema: object;
}

export function readAgreementFiles(root: string): AgreementFiles {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(join(root, AGREEMENT_DIRECTORY, name), "utf8"));
  const tableSchema = read("table.schema.json");

  if (typeof tableSchema !== "object" || tableSchema === null) {
    throw new Error(`${AGREEMENT_DIRECTORY}/table.schema.json is not a JSON Schema object`);
  }

  return { table: read("table.json"), tableSchema };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The schema names each direction of the contract's routes uses, by the `input` and `output` they spell. */
export function routeSchemaUses(api: LoadedApi): Record<AgreementRow["direction"], Set<string>> {
  const uses = { input: new Set<string>(), output: new Set<string>() };
  const surfaces = api.merged.surfaces;

  for (const surface of isObject(surfaces) ? Object.values(surfaces) : []) {
    const routes = isObject(surface) ? surface.routes : undefined;

    for (const route of isObject(routes) ? Object.values(routes) : []) {
      if (!isObject(route)) continue;

      for (const direction of ["input", "output"] as const) {
        const written = route[direction];

        if (typeof written === "string") uses[direction].add(written);
      }
    }
  }

  return uses;
}

function tableShapeProblems(table: unknown, tableSchema: object): string[] {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(tableSchema);

  if (validate(table)) return [];

  return (validate.errors ?? []).map(
    (error) => `table.json${error.instancePath}: ${error.message}`,
  );
}

export function agreementRows(table: unknown): AgreementRow[] {
  const rows: unknown = isObject(table) ? table.rows : undefined;
  const listed: unknown[] = Array.isArray(rows) ? rows : [];

  return listed.filter(isRow);
}

function isRow(value: unknown): value is AgreementRow {
  return isObject(value) && typeof value.id === "string" && typeof value.schema === "string";
}

function rowProblems(
  row: AgreementRow,
  api: LoadedApi,
  uses: ReturnType<typeof routeSchemaUses>,
): string[] {
  const problems: string[] = [];
  const schemas = api.merged.schemas;

  if (!isObject(schemas) || !(row.schema in schemas)) {
    problems.push(`${row.id}: schema ${row.schema} is not declared in the contract`);
  } else if (!uses[row.direction].has(row.schema)) {
    problems.push(`${row.id}: no route of the contract uses ${row.schema} as ${row.direction}`);
  }

  if (row.payloadText !== undefined) {
    try {
      JSON.parse(row.payloadText);
    } catch {
      problems.push(`${row.id}: payloadText is not JSON text`);
    }
  }

  if (row.received !== undefined && (row.expected !== "accept" || row.direction !== "input")) {
    problems.push(`${row.id}: only an accepted input has a received value`);
  }

  return problems;
}

function missingCases(rows: readonly AgreementRow[]): string[] {
  const present = new Set(rows.map((row) => row.case));

  return [...ADR_0015_CASES, ...ADR_0003_CASES]
    .filter((name) => !present.has(name))
    .map((name) => `no row for the case ${name}`);
}

function duplicateIds(rows: readonly AgreementRow[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const { id } of rows) (seen.has(id) ? duplicates : seen).add(id);

  return [...duplicates].map((id) => `${id}: the id is used by more than one row`);
}

/** Every problem of the table against its JSON Schema and the contract it names; empty when it is complete. */
export function agreementProblems(files: AgreementFiles, api: LoadedApi): string[] {
  const shape = tableShapeProblems(files.table, files.tableSchema);

  if (shape.length > 0) return shape;
  const rows = agreementRows(files.table);
  const uses = routeSchemaUses(api);

  return [
    ...rows.flatMap((row) => rowProblems(row, api, uses)),
    ...duplicateIds(rows),
    ...missingCases(rows),
  ];
}

// The shapes the IR keeps inline in their use instead of as a named schema (docs/ir/05-schemas.md).
const INLINE_SHAPES = ["string", "integer", "number", "boolean", "array"];

function irSchemaDirections(ir: JsonObject, name: string): unknown {
  const schemas = ir.schemas;
  const schema = isObject(schemas) ? schemas[name] : undefined;

  return isObject(schema) ? schema.directions : undefined;
}

function irRowProblems(row: AgreementRow, ir: JsonObject, api: LoadedApi): string[] {
  const directions = irSchemaDirections(ir, row.schema);

  if (Array.isArray(directions)) {
    return directions.includes(row.direction)
      ? []
      : [`${row.id}: the IR schema ${row.schema} has no ${row.direction} direction`];
  }

  const declarations = api.merged.schemas;
  const declaration = isObject(declarations) ? declarations[row.schema] : undefined;

  if (isObject(declaration) && INLINE_SHAPES.includes(String(declaration.type))) return [];

  return [`${row.id}: the IR holds no schema ${row.schema}`];
}

/** Every row whose schema the compiled IR does not hold with the row's direction (a scalar or array stays inline). */
export function agreementIrProblems(table: unknown, ir: JsonObject, api: LoadedApi): string[] {
  return agreementRows(table).flatMap((row) => irRowProblems(row, ir, api));
}

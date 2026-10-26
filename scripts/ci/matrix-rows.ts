import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "../golden/repo-root.ts";

export const WORKFLOWS_DIRECTORY = join(REPO_ROOT, ".github/workflows");

export type MatrixValue = string | number | boolean;
export type MatrixRow = Readonly<Record<string, MatrixValue>>;

// The `include` and `exclude` lists, and one list of values per axis.
export type WorkflowMatrix = Readonly<Record<string, readonly unknown[] | undefined>>;

export interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, string>>;
}

export interface WorkflowJob {
  readonly name?: string;
  readonly needs?: string | readonly string[];
  readonly if?: string;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly strategy?: { readonly matrix: WorkflowMatrix };
  readonly steps?: readonly WorkflowStep[];
}

export interface WorkflowDocument {
  readonly name: string;
  readonly on: Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
}

export function readWorkflow(file: string): WorkflowDocument {
  return parse(readFileSync(join(WORKFLOWS_DIRECTORY, file), "utf8"));
}

export function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIRECTORY)
    .filter((file) => file.endsWith(".yml"))
    .sort();
}

function matchesEveryKey(row: MatrixRow, partial: MatrixRow): boolean {
  return Object.entries(partial).every(([key, value]) => row[key] === value);
}

function isMatrixValue(value: unknown): value is MatrixValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isMatrixRow(value: unknown): value is MatrixRow {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((entry) => isMatrixValue(entry))
  );
}

function rowList(matrix: WorkflowMatrix, key: "include" | "exclude"): MatrixRow[] {
  const entries = matrix[key] ?? [];

  if (!entries.every(isMatrixRow)) {
    throw new Error(
      `ci: a matrix ${key} entry is not a map of plain values: ${JSON.stringify(entries)}.`,
    );
  }

  return [...entries];
}

function axisValues(axis: string, values: readonly unknown[] | undefined): MatrixValue[] {
  if (values === undefined || !values.every(isMatrixValue)) {
    throw new Error(
      `ci: the matrix axis '${axis}' is not a list of plain values: ${JSON.stringify(values)}.`,
    );
  }

  return [...values];
}

function axesProduct(matrix: WorkflowMatrix): MatrixRow[] {
  const axes = Object.entries(matrix).filter(([key]) => key !== "include" && key !== "exclude");

  if (axes.length === 0) return [];

  return axes.reduce<MatrixRow[]>(
    (rows, [axis, values]) =>
      rows.flatMap((row) => axisValues(axis, values).map((value) => ({ ...row, [axis]: value }))),
    [{}],
  );
}

// The rows GitHub expands a matrix to: the product of the axes without the excluded rows, then each include entry
// added to every row whose axis values it keeps, or appended as a row of its own when it fits none.
export function matrixRows(matrix: WorkflowMatrix): MatrixRow[] {
  const excludedRows = rowList(matrix, "exclude");
  const productRows = axesProduct(matrix).filter(
    (row) => !excludedRows.some((excluded) => matchesEveryKey(row, excluded)),
  );
  const axisNames = new Set(Object.keys(productRows[0] ?? {}));
  const rows: Record<string, MatrixValue>[] = productRows.map((row) => ({ ...row }));

  for (const included of rowList(matrix, "include")) {
    const keepsAxisValues = (row: MatrixRow): boolean =>
      Object.entries(included).every(([key, value]) => !axisNames.has(key) || row[key] === value);
    const extendedRows = productRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => keepsAxisValues(row));

    if (extendedRows.length === 0) {
      rows.push({ ...included });
      continue;
    }

    for (const { index } of extendedRows) rows[index] = { ...rows[index], ...included };
  }

  return rows;
}

// One row as `key=value` pairs in key order, so rows compare as strings.
export function rowLabel(row: MatrixRow): string {
  return Object.keys(row)
    .sort()
    .map((key) => `${key}=${String(row[key])}`)
    .join(", ");
}

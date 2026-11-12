import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { EXPECTED_ROOT, REPO_ROOT } from "./fixtures.ts";

// The reader and validator of `fixtures/expected/differences.yaml` (semantics: `differences.schema.json`).

export const DIFFERENCES_FILE = join(EXPECTED_ROOT, "differences.yaml");
const SCHEMA_FILE = join(import.meta.dirname, "differences.schema.json");

export type DifferenceChange =
  | "value"
  | "added"
  | "removed"
  | "message"
  | "code-renamed"
  | "format";
export type DifferenceOutput =
  | "ir"
  | "diagnostics"
  | "source-map"
  | "halves"
  | "openapi"
  | "generated";

export interface Difference {
  id: string;
  reason: string;
  decision: string;
  applies: { fixtures: string[]; output: DifferenceOutput; pointer?: string; path?: string };
  change: DifferenceChange;
  /** The TS output: a JSON value, or a bigint for an integer beyond 2^53. */
  from?: unknown;
  to?: unknown;
}

export interface Differences {
  version: 1;
  differences: Difference[];
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

// Validation does not depend on the size of an integer, so a bigint is checked as the number it rounds to.
function validationCopy(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);

  if (Array.isArray(value)) return value.map(validationCopy);

  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, validationCopy(member)]),
    );

  return value;
}

// Only asked of a document the schema accepted.
const isDifferences = (value: unknown): value is Differences => isObject(value);

function schemaProblems(document: unknown): string[] {
  const schema: unknown = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));

  if (!isObject(schema)) throw new Error(`${SCHEMA_FILE} is a JSON Schema object`);

  const validate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(
    schema,
  );

  if (validate(validationCopy(document))) return [];

  return (validate.errors ?? []).map(
    ({ instancePath, message }) => `${instancePath || "/"} ${message}`,
  );
}

// The anchor a Markdown heading gets: lower case, punctuation dropped, spaces to hyphens.
const headingAnchor = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replaceAll(" ", "-");

function hasAnchor(text: string, anchor: string): boolean {
  if (text.includes(`id="${anchor}"`)) return true;

  return text
    .split("\n")
    .some((line) => /^#{1,6} /.test(line) && headingAnchor(line.replace(/^#+/, "")) === anchor);
}

function anchorProblem(entry: Difference): string | undefined {
  const [file = "", anchor = ""] = entry.decision.split("#");
  const path = join(REPO_ROOT, file);

  if (!existsSync(path)) return `${entry.id}: decision ${file} is no committed doc`;

  return hasAnchor(readFileSync(path, "utf8"), anchor)
    ? undefined
    : `${entry.id}: decision ${file} has no anchor ${anchor}`;
}

/** The problems of a parsed differences file: schema, duplicate ids, decision docs. Empty when it is valid. */
export function differencesProblems(document: unknown): string[] {
  const problems = schemaProblems(document);

  if (problems.length > 0 || !isDifferences(document)) return problems;

  const seen = new Set<string>();

  for (const entry of document.differences) {
    if (seen.has(entry.id)) problems.push(`${entry.id}: the id is used twice`);
    seen.add(entry.id);

    const problem = anchorProblem(entry);

    if (problem !== undefined) problems.push(problem);
  }

  return problems;
}

/** Reads and validates a differences file; throws with every problem when it is invalid. */
export function readDifferences(path: string = DIFFERENCES_FILE): Differences {
  const document: unknown = parse(readFileSync(path, "utf8"), { intAsBigInt: true });
  const problems = differencesProblems(document);

  if (problems.length > 0 || !isDifferences(document))
    throw new Error(`${path} is invalid:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);

  return document;
}

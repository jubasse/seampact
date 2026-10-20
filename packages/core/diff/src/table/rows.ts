import type { DiffBreak, DiffClassification, DiffPosition } from "../result.js";

// The default classification table (FR-13, CHK-175, CHK-176): each row is a change kind, each case a cell per
// position. `C` breaks clients, `S` breaks servers, `CS` both, `-` is additive, `info` is reported and never gated.
// A change breaks clients when a client generated from `before`, unchanged, sends a request `after` refuses or
// reads a response it refuses or misreads; it breaks servers when a handler written for `before`, behind a boundary
// regenerated from `after`, can receive an input it was not written for or return an output `after` refuses.

export type DiffFact =
  | "afterRefusesUnknownKeys"
  | "afterRefusesUnknownQuery"
  | "outputEnumsOpenInBoth";

export interface ConditionalCell {
  readonly when: DiffFact;
  readonly holds: DiffCell;
  readonly otherwise: DiffCell;
}

export type DiffCell = "C" | "S" | "CS" | "-" | "info" | ConditionalCell;

export type DiffCaseCells = { readonly [position in DiffPosition]?: DiffCell };

const BOTH_POSITIONS_CS: DiffCaseCells = { input: "CS", output: "CS" };

export const DIFF_TABLE = {
  "operation.added": { added: { none: "-" } },
  "operation.removed": { removed: { none: "C" } },
  "operation.route": {
    method: { none: "CS" },
    path: { none: "CS" },
    surface: { none: "CS" },
    surfacePrefix: { none: "CS" },
    pathVersion: { none: "CS" },
  },
  "operation.format": { changed: { none: "CS" } },
  "property.added": {
    optional: { input: "-", output: "-" },
    required: { input: "C", output: "S" },
  },
  "property.removed": {
    required: { input: "CS", output: "C" },
    optional: {
      input: { when: "afterRefusesUnknownKeys", holds: "C", otherwise: "-" },
      output: "-",
    },
  },
  "property.required": {
    optionalToRequired: { input: "C", output: "S" },
    requiredToOptional: { input: "S", output: "C" },
  },
  nullable: {
    added: { input: "S", output: "C" },
    removed: { input: "C", output: "S" },
  },
  "type.changed": {
    kind: BOTH_POSITIONS_CS,
    scalarType: BOTH_POSITIONS_CS,
    format: BOTH_POSITIONS_CS,
    ref: BOTH_POSITIONS_CS,
    enum: BOTH_POSITIONS_CS,
    keys: BOTH_POSITIONS_CS,
    content: BOTH_POSITIONS_CS,
    body: BOTH_POSITIONS_CS,
    variantSchema: BOTH_POSITIONS_CS,
    int64Wire: BOTH_POSITIONS_CS,
    outputEnums: BOTH_POSITIONS_CS,
    urls: BOTH_POSITIONS_CS,
  },
  refinement: {
    tightened: { input: "C", output: "S" },
    loosened: { input: "S", output: "C" },
    // A multipleOf neither a multiple nor a divisor of the old one: values both gained and lost.
    changed: BOTH_POSITIONS_CS,
  },
  "pattern.changed": { changed: BOTH_POSITIONS_CS },
  "enum.value": {
    added: {
      input: "S",
      output: { when: "outputEnumsOpenInBoth", holds: "-", otherwise: "C" },
    },
    removed: { input: "C", output: "S" },
  },
  "union.variant": {
    added: { input: "S", output: "C" },
    removed: { input: "C", output: "S" },
  },
  "union.tag": { changed: BOTH_POSITIONS_CS },
  "default.changed": {
    added: { input: "C", output: "info" },
    changed: { input: "C", output: "info" },
    removed: { input: "C", output: "info" },
  },
  "param.added": {
    optional: { input: "-" },
    required: { input: "C" },
  },
  "param.removed": {
    required: { input: "CS" },
    optional: { input: { when: "afterRefusesUnknownQuery", holds: "C", otherwise: "-" } },
  },
  // A body has one media type: a change removes the one a client sends.
  body: {
    added: { input: "C" },
    removed: { input: "CS" },
    mediaRemoved: { input: "C" },
  },
  response: {
    added: { output: "C" },
    removed: { output: "S" },
    changed: { output: "CS" },
    mediaChanged: { output: "CS" },
  },
  maturity: {
    lowered: { none: "C" },
    raised: { none: "info" },
  },
  deprecation: {
    added: { none: "info" },
    removed: { none: "info" },
    sinceChanged: { none: "info" },
    sunsetLater: { none: "info" },
    successorChanged: { none: "info" },
    sunsetEarlier: { none: "C" },
  },
  "compat.policy": { changed: { none: "info" } },
  "pack.upgraded": {
    added: { none: "info" },
    removed: { none: "info" },
    version: { none: "info" },
  },
  order: {
    properties: { input: "info", output: "info", none: "info" },
    variants: { input: "info", output: "info", none: "info" },
    values: { input: "info", output: "info", none: "info" },
    params: { input: "info" },
    packs: { none: "info" },
  },
  name: { any: { input: "info", output: "info", none: "info" } },
  annotation: { any: { input: "info", output: "info", none: "info" } },
  unclassified: { any: { input: "CS", output: "CS", none: "CS" } },
} as const satisfies Record<string, Record<string, DiffCaseCells>>;

export type DiffKind = keyof typeof DIFF_TABLE;

// The rows whose cases are free text (the member changed): one `any` cell set covers them.
const FREE_CASE_KINDS: ReadonlySet<DiffKind> = new Set(["name", "annotation", "unclassified"]);

export interface DiffCellOutcome {
  breaks: DiffBreak[];
  classification: DiffClassification;
}

/** The cell of `kind` and `caseName` at `position`, its conditions read from `facts`; undefined when absent. */
export function classifyCell(
  kind: DiffKind,
  caseName: string,
  position: DiffPosition,
  facts: ReadonlySet<DiffFact>,
): DiffCellOutcome | undefined {
  const cases: Record<string, DiffCaseCells> = DIFF_TABLE[kind];
  const cells = cases[FREE_CASE_KINDS.has(kind) ? "any" : caseName];
  const cell = cells?.[position];

  if (cell === undefined) return undefined;

  return outcomeOf(resolveCell(cell, facts));
}

function resolveCell(
  cell: DiffCell,
  facts: ReadonlySet<DiffFact>,
): Exclude<DiffCell, ConditionalCell> {
  if (typeof cell === "string") return cell;

  return resolveCell(facts.has(cell.when) ? cell.holds : cell.otherwise, facts);
}

function outcomeOf(cell: Exclude<DiffCell, ConditionalCell>): DiffCellOutcome {
  switch (cell) {
    case "C":
      return { breaks: ["clients"], classification: "breaking" };
    case "S":
      return { breaks: ["servers"], classification: "breaking" };
    case "CS":
      return { breaks: ["clients", "servers"], classification: "breaking" };
    case "-":
      return { breaks: [], classification: "additive" };
    case "info":
      return { breaks: [], classification: "informative" };
  }
}

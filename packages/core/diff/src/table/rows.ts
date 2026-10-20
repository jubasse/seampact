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

// A schema or declaration reached by no operation in either IR changes no request or response: `info` at `none`.
const UNREACHED = "info";

const BOTH_POSITIONS_CS: DiffCaseCells = { input: "CS", output: "CS", none: UNREACHED };

const INPUT_CS: DiffCaseCells = { input: "CS", none: UNREACHED };

const OUTPUT_CS: DiffCaseCells = { output: "CS", none: UNREACHED };

// A request requirement: adding one refuses requests `before` clients send, removing one lets handlers receive
// requests they were written to never see.
const REQUEST_REQUIREMENT = {
  added: { input: "C" },
  removed: { input: "S" },
  changed: { input: "CS" },
} as const satisfies Record<string, DiffCaseCells>;

export const DIFF_TABLE = {
  "operation.added": { added: { none: "-" } },
  "operation.removed": { removed: { none: "C" } },
  "operation.route": {
    method: { none: "CS" },
    path: { none: "CS" },
    surface: { none: "CS" },
    surfacePrefix: { none: "CS" },
    pathVersion: { none: "CS" },
    // Whether the request may be retried and cached as a read.
    safe: { none: "CS" },
  },
  "operation.format": { changed: { none: "CS" } },
  "property.added": {
    optional: { input: "-", output: "-", none: UNREACHED },
    required: { input: "C", output: "S", none: UNREACHED },
  },
  "property.removed": {
    required: { input: "CS", output: "C", none: UNREACHED },
    optional: {
      input: { when: "afterRefusesUnknownKeys", holds: "C", otherwise: "-" },
      output: "-",
      none: UNREACHED,
    },
  },
  "property.required": {
    optionalToRequired: { input: "C", output: "S", none: UNREACHED },
    requiredToOptional: { input: "S", output: "C", none: UNREACHED },
  },
  nullable: {
    added: { input: "S", output: "C", none: UNREACHED },
    removed: { input: "C", output: "S", none: UNREACHED },
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
    // A query param's or a form field's wire form (style, explode, brackets): input only.
    wire: INPUT_CS,
  },
  refinement: {
    tightened: { input: "C", output: "S", none: UNREACHED },
    loosened: { input: "S", output: "C", none: UNREACHED },
    // A multipleOf neither a multiple nor a divisor of the old one: values both gained and lost.
    changed: BOTH_POSITIONS_CS,
  },
  "pattern.changed": { changed: BOTH_POSITIONS_CS },
  "enum.value": {
    added: {
      input: "S",
      output: { when: "outputEnumsOpenInBoth", holds: "-", otherwise: "C" },
      none: UNREACHED,
    },
    removed: { input: "C", output: "S", none: UNREACHED },
  },
  "union.variant": {
    added: { input: "S", output: "C", none: UNREACHED },
    removed: { input: "C", output: "S", none: UNREACHED },
  },
  "union.tag": { changed: BOTH_POSITIONS_CS },
  "default.changed": {
    added: { input: "C", output: "info", none: UNREACHED },
    changed: { input: "C", output: "info", none: UNREACHED },
    removed: { input: "C", output: "info", none: UNREACHED },
  },
  "param.added": {
    optional: { input: "-" },
    required: { input: "C" },
  },
  "param.removed": {
    required: { input: "CS" },
    optional: { input: { when: "afterRefusesUnknownQuery", holds: "C", otherwise: "-" } },
  },
  "param.required": {
    optionalToRequired: { input: "C" },
    requiredToOptional: { input: "S" },
  },
  // The policy for undeclared query keys.
  unknownQuery: {
    refused: { input: "C" },
    ignored: { input: "-" },
  },
  // The policy for undeclared keys of a referenced object, absent read as `refuse`; set on input uses only.
  unknownKeys: {
    refused: { input: "C", none: UNREACHED },
    ignored: { input: "-", none: UNREACHED },
    kept: { input: "S", none: UNREACHED },
  },
  // A body has one media type: a change removes the one a client sends.
  body: {
    added: { input: "C" },
    removed: { input: "CS" },
    mediaRemoved: { input: "C" },
    // The handler reads the raw bytes, or stops getting them.
    rawBody: { input: "S" },
  },
  // A body rule proof (a field or header the rule checks).
  proof: {
    added: { input: "C" },
    removed: { input: "CS" },
  },
  response: {
    added: { output: "C" },
    removed: { output: "S" },
    changed: { output: "CS" },
    mediaChanged: { output: "CS" },
    // The format shape (item, list, page, empty...) that wraps the payload.
    shape: { output: "CS" },
  },
  "responseHeader.added": {
    optional: { output: "-" },
    required: { output: "S" },
  },
  "responseHeader.removed": {
    required: { output: "C" },
    optional: { output: "-" },
  },
  "responseHeader.required": {
    optionalToRequired: { output: "S" },
    requiredToOptional: { output: "C" },
  },
  "responseHeader.semantic": { changed: { output: "CS" } },
  // Access ranks public, optional with a refused credential read as anonymous, optional rejecting it, identity.
  access: {
    tightened: { input: "C" },
    loosened: { input: "S" },
    principalOptionalAdded: { input: "-" },
    principalOptionalRemoved: { input: "S" },
    identity: { input: "CS" },
    schemeAdded: { input: "-" },
    schemeRemoved: { input: "C" },
  },
  callerKind: {
    added: { input: "S" },
    removed: { input: "C" },
  },
  // A principal field the caller must hold, matched by name.
  principalRequirement: { added: { input: "C" }, removed: { input: "S" } },
  scope: { ...REQUEST_REQUIREMENT, within: BOTH_POSITIONS_CS },
  requirement: REQUEST_REQUIREMENT,
  binding: REQUEST_REQUIREMENT,
  csrf: REQUEST_REQUIREMENT,
  owner: REQUEST_REQUIREMENT,
  concurrency: REQUEST_REQUIREMENT,
  // A field right restricts a field: an input one refuses or strips it, an output one leaves it out.
  fieldRight: {
    added: { input: "C", output: "C", none: UNREACHED },
    removed: { input: "S", output: "-", none: UNREACHED },
    changed: { input: "CS", output: "CS", none: UNREACHED },
  },
  // The right filtering a list's items.
  filteredBy: {
    added: { output: "C" },
    removed: { output: "S" },
    changed: { output: "CS" },
  },
  idempotency: {
    addedRequired: { input: "C" },
    addedOptional: { input: "-" },
    removed: { input: "S" },
    optionalToRequired: { input: "C" },
    requiredToOptional: { input: "S" },
    header: { input: "CS" },
    replayHeader: { output: "C" },
    lifetimeShortened: { input: "S" },
    // Under a boundary a key reused after the old lifetime is refused or replayed; unenforced, the handler decides.
    lifetimeLengthened: { input: "C" },
    lifetimeLengthenedUnenforced: { input: "-" },
    enforceDropped: { input: "S" },
    enforceAdded: { input: "C" },
  },
  paging: {
    added: { input: "CS" },
    removed: { input: "CS" },
    style: { input: "CS" },
    token: { input: "CS" },
    defaultLimit: { input: "CS" },
    overLimitRejected: { input: "C" },
    overLimitClamped: { input: "-" },
    sortKeyAdded: { input: "S" },
    sortKeyRemoved: { input: "C" },
    sortKeyChanged: { input: "CS" },
  },
  // An error code the operation answers, then its declaration, classified at the operations answering it.
  error: {
    added: { output: "C" },
    removed: { output: "S" },
    roles: { output: "CS" },
    retryHeaderAdded: { output: "-" },
    retryHeaderRemoved: { output: "C" },
    retryHeaderChanged: { output: "CS" },
    status: OUTPUT_CS,
    nature: { output: "C", none: UNREACHED },
    family: { output: "C", none: UNREACHED },
  },
  // Declarations, classified at the operations using them; a catalogue entry added or removed is classified
  // where an operation starts or stops naming it.
  declaration: {
    added: { none: UNREACHED },
    removed: { none: UNREACHED },
  },
  format: {
    media: OUTPUT_CS,
    absent: OUTPUT_CS,
    success: OUTPUT_CS,
    meta: OUTPUT_CS,
    error: OUTPUT_CS,
  },
  // Read at the input for its request params, at the output for its page body and handler result.
  pagingStyle: {
    position: BOTH_POSITIONS_CS,
    absent: OUTPUT_CS,
    request: INPUT_CS,
    response: OUTPUT_CS,
    handlerResult: { output: "S", none: UNREACHED },
  },
  scheme: {
    kind: { input: "C", none: UNREACHED },
    name: { input: "C", none: UNREACHED },
    csrf: { input: "C", none: UNREACHED },
    signature: INPUT_CS,
  },
  identity: {
    kind: INPUT_CS,
    schemeAdded: { input: "-", none: UNREACHED },
    schemeRemoved: { input: "C", none: UNREACHED },
    schemeRoles: INPUT_CS,
    principal: INPUT_CS,
    unknownKeys: INPUT_CS,
    headerAddedRequired: { input: "C", none: UNREACHED },
    headerAddedOptional: { input: "-", none: UNREACHED },
    headerRemoved: { input: "S", none: UNREACHED },
    headerChanged: INPUT_CS,
  },
  // A right guards requests (input) and the fields and list items it filters (output).
  right: {
    subject: BOTH_POSITIONS_CS,
    guestAdded: { input: "S", output: "S", none: UNREACHED },
    guestRemoved: { input: "C", output: "C", none: UNREACHED },
  },
  rule: {
    takesBucket: INPUT_CS,
    proof: INPUT_CS,
  },
  bucket: { key: INPUT_CS },
  header: {
    semantic: INPUT_CS,
    name: INPUT_CS,
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
    scopes: { input: "info" },
    requires: { input: "info" },
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

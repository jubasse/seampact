import type { ApiVersion, CompatPolicy, MaturitySource, PackRef } from "@seampact/spec/ir";
import type { DiffCode } from "./diff-codes.js";
import type { DiffExemption, DiffGateScope } from "./options.js";
import type { DiffKind } from "./table/rows.js";

// The value `diffContracts` returns: the JSON form of the report is this value itself.

/** Where a change is reached from: the request, a response, or neither (an operation or api member). */
export type DiffPosition = "input" | "output" | "none";

/** A side a change breaks (FR-13): a client generated from `before`, or a handler written for it. */
export type DiffBreak = "clients" | "servers";

export type DiffClassification = "additive" | "breaking" | "informative";

/** A value a change reports: scalars only, never an IR object. */
export type DiffValue = string | number | boolean | null;

export interface DiffChange {
  /** The row of the classification table. */
  kind: DiffKind;
  /** The row's case (`required`, `tightened`), or the IR member for `unclassified`. */
  case: string;
  /** A JSON Pointer into `after`, into `before` for a removal. */
  pointer: string;
  position: DiffPosition;
  /** The ids of the operations that reach the change, sorted; empty for an api-wide change. */
  operations: string[];
  breaks: DiffBreak[];
  classification: DiffClassification;
  before?: DiffValue;
  after?: DiffValue;
  /** The pack whose upgrade caused the change, read from the element's `Origin.layer`. */
  cause?: { pack: string };
  /** The exemption that keeps a breaking change from failing the gate. */
  exemption?: DiffExemption;
}

export interface DiffRefusal {
  code: DiffCode;
  message: string;
  fix: string;
  before?: DiffValue;
  after?: DiffValue;
  /** The IR member holding an unknown value. */
  member?: string;
  operations?: string[];
}

export interface GateFailure {
  code: DiffCode;
  message: string;
  fix: string;
  kind: DiffKind;
  case: string;
  pointer: string;
  position: DiffPosition;
  breaks: DiffBreak[];
  operations: string[];
  /** For `diff.maturity.stable`: the stable operation (absent for the api itself), its level and its source. */
  maturity?: { operation?: string; level: string; source: MaturitySource };
}

/** What became of an operation deprecated in `after`, or deprecated in `before` and gone from `after`. */
export type OperationDeprecationStatus =
  | "new"
  | "kept"
  | "sunsetEarlier"
  | "sunsetLater"
  | "successorChanged"
  | "removed"
  | "sunsetPassed";

export type DeprecationEntry =
  | {
      subject: "operation";
      operation: string;
      pointer: string;
      status: OperationDeprecationStatus;
      since: string;
      sunset: string;
      /** The successor operation id. */
      successor?: string;
      /** Days from `options.today` to the sunset, negative once past. */
      daysToSunset: number;
      /** The sunset is on or before `options.today`. */
      pastSunset: boolean;
    }
  | {
      subject: "schema" | "property";
      pointer: string;
      schema: string;
      property?: string;
      /** `deprecated` set in `after`, or cleared. */
      status: "deprecated" | "undeprecated";
    };

export interface DiffSide {
  version: ApiVersion;
  irRevision: number;
  packs: PackRef[];
}

export type DiffResult =
  | { ok: false; refusals: DiffRefusal[] }
  | {
      ok: true;
      api: string;
      before: DiffSide;
      after: DiffSide;
      policy: { before: CompatPolicy; after: CompatPolicy; applied: CompatPolicy };
      /** The gate settings applied, defaults filled in. */
      settings: { gate: DiffGateScope; exempt: DiffExemption[] };
      changes: DiffChange[];
      gate: { passed: boolean; failures: GateFailure[] };
      deprecations: DeprecationEntry[];
    };

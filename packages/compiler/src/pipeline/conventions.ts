import type { Origin } from "@seampact/spec/ir";
import type { JsonValue } from "../raw-tree.js";

// The conventions a pass reads (ADR 0002 section 13, ADR 0006 section 2): the merged `conventions` of the api's
// layers, each value with the origin of the layer that wrote it, or the core default with no origin. The core
// defaults are data (PR 2 of p2-pipeline adds the reader and the table); the IR `conventions` map lists only
// written conventions, so a default never reaches it with a made-up origin.

/** A convention value: written (with its origin) or the core default (no origin). */
export interface ConventionReading {
  value: JsonValue;
  /** Absent for a core default of ADR 0002 section 13. */
  origin?: Origin;
}

export interface ResolvedConventions {
  /**
   * The value at a dotted path under `conventions` (`bodyLimit`, `idempotency.header`, `errors.derived`), or the
   * core default; undefined when neither is set.
   */
  get(path: string): ConventionReading | undefined;
}

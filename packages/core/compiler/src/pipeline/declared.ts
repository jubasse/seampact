import type { Origin } from "@seampact/spec/ir";
import type { RawApi } from "../raw-tree.js";
import { isJsonObject, pipelineOrigin, pointerBelow } from "./pointer.js";
import type { PassReadonly } from "./readonly.js";

// The declarations an api's layers write, for the lint rule that reports the unused ones: finalize drops them
// from the IR (ADR 0004 section 2), so only the merged raw catalogues still list them.

/** The catalogues of grammar 01 (the `requirements` entries expand into each route's `requires`) and `formats`. */
const DECLARED_CATALOGUES = [
  "schemas",
  "enums",
  "scalars",
  "errors",
  "natures",
  "schemes",
  "headers",
  "identities",
  "rights",
  "rules",
  "requirements",
  "scopes",
  "buckets",
  "services",
  "pagings",
  "formats",
] as const;

export interface PipelineDeclared {
  readonly catalogue: string;
  readonly id: string;
  /** Where the winning layer wrote the entry. */
  readonly origin: Origin;
}

/** Every entry of the api's merged catalogues, in catalogue then key order, with its winning layer's origin. */
export function pipelineDeclared(raw: PassReadonly<RawApi>): PipelineDeclared[] {
  const declared: PipelineDeclared[] = [];

  for (const catalogue of DECLARED_CATALOGUES) {
    const entries = raw.merged[catalogue];

    if (!isJsonObject(entries)) continue;

    for (const id of Object.keys(entries)) {
      const origin = pipelineOrigin(raw, pointerBelow(`/${catalogue}`, id));

      if (origin === undefined)
        throw new Error(`the ${catalogue} entry ${id} of api ${raw.name} has no origin`);
      declared.push({ catalogue, id, origin });
    }
  }

  return declared;
}

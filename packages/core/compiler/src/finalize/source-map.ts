import {
  type ContractIR,
  IR_REVISION,
  type Origin,
  type SourceMap,
  walkIrInstance,
} from "@seampact/spec/ir";
import { diagnosticLocationKey } from "../diagnostics/print.js";
import { type PassReadonly, pipelineCopy } from "../pipeline/seam.js";
import type { RawApi } from "../raw-tree.js";

// The side table of one api's IR (ADR 0004 section 11): one entry per origin of the IR, found in the api's
// `RawApi.locations`. A `core` origin has none (no file), and nor has an origin that names another `api`: a relay
// route copied it, and it resolves in that api's own table (ADR 0004 section 6).

const ORIGIN_DEFINITION = "Origin";

const API_LAYERS: readonly string[] = ["api", "shared", "base"];

// A layer of an api's raw tree: `core` has no file and no IR element carries `workspace` (ADR 0004 section 6).
const isApiLayer = (layer: unknown): layer is Exclude<Origin["layer"], "core" | "workspace"> =>
  typeof layer === "string" && (API_LAYERS.includes(layer) || layer.startsWith("pack:"));

export function finalizeSourceMap(ir: ContractIR, raw: PassReadonly<RawApi>): SourceMap {
  const locations: SourceMap["locations"] = {};

  walkIrInstance(ir, (node) => {
    if (node.kind !== "object" || node.definition !== ORIGIN_DEFINITION) return;
    const { api, layer, pointer } = node.value;

    if (api !== undefined || layer === "core") return;

    if (!isApiLayer(layer) || typeof pointer !== "string")
      throw new Error(
        `finalize: the origin at '${node.pointer}' of api '${raw.name}' has no valid layer or pointer`,
      );
    const key = diagnosticLocationKey({ layer, pointer });
    const location = Object.hasOwn(raw.locations, key) ? raw.locations[key] : undefined;

    if (location === undefined)
      throw new Error(
        `finalize: the origin '${key}' at '${node.pointer}' of api '${raw.name}' is in no source table, so the pass that wrote it located it nowhere`,
      );

    locations[key] = pipelineCopy(location);
  });

  return { irRevision: IR_REVISION, locations };
}

import type { Origin, SourceMap } from "@seampact/spec/ir";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type LayerKind = "api" | "base" | "shared" | "pack";

// `layer` is the single source of truth; the kind is derived by `layerKindOf`.
export interface RawLayer {
  layer: Origin["layer"];
  file: string;
  tree: JsonObject;
}

export function layerKindOf(layer: Origin["layer"]): LayerKind {
  return layer.startsWith("pack:") ? "pack" : (layer as Exclude<LayerKind, "pack">);
}

// ADR 0002 section 2: `layers` in application order.
export interface RawApi {
  name: string;
  layers: RawLayer[];
  merged: JsonObject;
  leafOrigins: Record<string, Origin>;
}

// `locations` only: the `SourceMap` revision belongs to the IR written by finalize (ADR 0004 section 11).
export interface RawWorkspace {
  root: string;
  apis: RawApi[];
  locations: SourceMap["locations"];
}

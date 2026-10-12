import type { Origin, SourceMap } from "@seampact/spec/ir";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type LayerKind = "api" | "base" | "shared" | "pack";

// One layer after `$include` and `$file` are resolved, `$ref` kept; `file` is relative to the workspace root, forward slashes.
export interface RawLayer {
  layer: Origin["layer"];
  kind: LayerKind;
  file: string;
  tree: JsonObject;
}

// `layers` in application order (ADR 0002 section 2); `leafOrigins` maps a pointer in `merged` to the origin of the layer that won.
export interface RawApi {
  name: string;
  layers: RawLayer[];
  merged: JsonObject;
  leafOrigins: Record<string, Origin>;
}

export interface RawWorkspace {
  root: string;
  apis: RawApi[];
  sourceMap: SourceMap;
}

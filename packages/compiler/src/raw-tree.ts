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
  /**
   * ADR 0004 section 11, this api's side table: every pointer of every layer of the api, keyed
   * exactly `"<layer>#<pointer>"`, so a `leafOrigins` entry resolves as written. Finalize
   * assembles the api's `SourceMap` from it.
   */
  locations: SourceMap["locations"];
  /** ADR 0002 section 2: per layer, the layers whose names it may resolve, itself included, sorted. */
  visibility: Record<Origin["layer"], Origin["layer"][]>;
}

/** What `workspace.yaml` says besides the apis, passed through unread (p3-cli, p3-dist). */
export interface RawWorkspaceConfig {
  editorSchemas?: string;
  imports?: JsonValue;
}

// The `SourceMap` revision belongs to the IR written by finalize (ADR 0004 section 11).
export interface RawWorkspace {
  root: string;
  apis: RawApi[];
  /**
   * The table for what no api's tree owns: the load stage's diagnostics. Each is located by a
   * site pointer, a position in a file (`/~load/<file>/<line>/<col>`) rather than a node of an
   * api's tree, so its key is the same whichever api reached the file: the workspace file, a
   * shared file or a pack read by several apis are located once, here. Every pass after load
   * locates its diagnostics through the table of the api they belong to, `RawApi.locations`.
   */
  locations: SourceMap["locations"];
  config?: RawWorkspaceConfig;
}

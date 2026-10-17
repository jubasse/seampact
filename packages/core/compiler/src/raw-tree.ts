import type { Origin, SourceMap } from "@seampact/spec/ir";
import { diagnosticLocationKey } from "./diagnostics/print.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type LayerKind = "api" | "base" | "shared" | "pack";

// The layers of an api: every origin layer but `workspace`, which only names the entry file, and
// `core`, a declaration the compiler supplies with no file and no side-table entry (ADR 0004
// section 6), so neither can be cast into a layer kind.
export type ApiLayerId = Exclude<Origin["layer"], "workspace" | "core">;

// A layer read from a file: a layer of an api, or the workspace entry file. Never `core`.
export type FileLayerId = ApiLayerId | "workspace";

// `layer` is the single source of truth; the kind is derived by `layerKindOf`.
export interface RawLayer {
  layer: ApiLayerId;
  file: string;
  tree: JsonObject;
}

// The workspace entry document (ADR 0002 section 1), validated as kind `workspace`. Not a layer of
// any api: its own type, so no layer-kind function accepts it.
export interface RawEntryLayer {
  layer: "workspace";
  file: string;
  tree: JsonObject;
}

/**
 * The key that locates a pointer of the workspace entry document in `RawWorkspace.locations`,
 * `workspace#<pointer>` (ADR 0006 section 4). A stage that reports on the entry gives its
 * diagnostic the origin `{ layer: "workspace", pointer }`; this is the one place the key is spelled.
 */
export function entryLocationKey(pointer: string): string {
  return diagnosticLocationKey({ layer: "workspace", pointer });
}

export function layerKindOf(layer: ApiLayerId): LayerKind {
  return layer.startsWith("pack:") ? "pack" : (layer as Exclude<LayerKind, "pack">);
}

// The authoring schema a layer's document is read as (P6, by the load stage) and validated as (by
// the validate stage): one mapping for both. The shared file is a base (ADR 0002 section 1).
export type LayerSchemaKind = "workspace" | "api" | "base" | "pack";

const LAYER_SCHEMA: Record<LayerKind, LayerSchemaKind> = {
  api: "api",
  base: "base",
  shared: "base",
  pack: "pack",
};

export function schemaKindOf(layer: FileLayerId): LayerSchemaKind {
  return layer === "workspace" ? "workspace" : LAYER_SCHEMA[layerKindOf(layer)];
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
  visibility: Record<ApiLayerId, ApiLayerId[]>;
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
   *
   * This table and any api's `locations` form a union without collisions: every key here has a
   * pointer starting `/~load/`, which JSON Pointer escaping never produces (`~` is always `~0`
   * or `~1`), and no key of an api's table does. (The one way to make two keys meet is a layer id
   * holding `#/~load/`, which only a pack manifest's name could; layer ids are `api`, `base`,
   * `shared` and `pack:<name>`.) The layer of a load origin is informational:
   * it is the layer being loaded when the diagnostic was first reported (a file reached by
   * several apis or layers is reported once), part of the key but not an owner. A consumer that
   * sorts diagnostics of several apis together looks each one up in its own table first.
   */
  locations: SourceMap["locations"];
  /**
   * The whole entry document when it is a `workspace.yaml`, absent for a single api file. Its
   * pointers are located in `locations` keyed `workspace#<pointer>`, a prefix no key of the
   * `/~load/` sites or of an api's table has (an api layer id is never `workspace`).
   */
  entry?: RawEntryLayer;
  /** The loader's own read of `editorSchemas` and `imports`, besides `entry`. */
  config?: RawWorkspaceConfig;
}

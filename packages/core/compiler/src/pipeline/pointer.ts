import type { Origin } from "@seampact/spec/ir";
import { escapePointer } from "@seampact/spec/json";
import type { JsonObject, JsonValue, RawApi } from "../raw-tree.js";
import type { PassReadonly } from "./readonly.js";

// JSON Pointers into the merged raw tree (RFC 6901), and the origin of the node a pointer names. Internal to
// `pipeline/`; halves reach `pipelineOrigin` through `context.origin`.

type Json = PassReadonly<JsonValue>;

export const isJsonObject = (value: Json | undefined): value is PassReadonly<JsonObject> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJsonList = (value: Json | undefined): value is readonly Json[] =>
  Array.isArray(value);

const escapeSegment = (segment: string | number): string => `/${escapePointer(segment)}`;

/** The pointer below `base` through `segments`. */
export const pointerBelow = (base: string, ...segments: readonly (string | number)[]): string =>
  base + segments.map(escapeSegment).join("");

function segmentsOf(pointer: string): string[] | undefined {
  if (pointer === "") return [];

  if (!pointer.startsWith("/")) return undefined;

  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** The value at `segments` below `value`, own members only; undefined when absent. */
export function jsonAt(value: Json | undefined, segments: readonly string[]): Json | undefined {
  let at = value;

  for (const segment of segments) {
    if (isJsonList(at)) {
      at = /^(0|[1-9][0-9]*)$/.test(segment) ? at[Number(segment)] : undefined;
    } else if (isJsonObject(at)) {
      at = Object.hasOwn(at, segment) ? at[segment] : undefined;
    } else {
      return undefined;
    }
  }

  return at;
}

/** The value a pointer names in a tree, by reference (a pass copies it with `pipelineCopy` before storing it); undefined when it names nothing. */
export function jsonAtPointer(value: Json, pointer: string): Json | undefined {
  const segments = segmentsOf(pointer);

  return segments === undefined ? undefined : jsonAt(value, segments);
}

const originCopy = (origin: PassReadonly<Origin>, pointer = origin.pointer): Origin =>
  origin.api === undefined
    ? { layer: origin.layer, pointer }
    : { api: origin.api, layer: origin.layer, pointer };

/**
 * The origin of the node `pointer` names in the api's merged raw tree (ADR 0004 section 6), a new object a half
 * may store in the draft; undefined when the pointer names no node.
 * - A leaf, a list (one value) or a declaration: its own entry of `RawApi.leafOrigins`.
 * - A node inside a list or a declaration: that entry's layer, at the node's pointer.
 * - An object the layers merge by leaf path (a surface, a route, a node's settings): the last layer in application
 *   order that writes it, the one whose leaves win (ADR 0002 section 2).
 */
export function pipelineOrigin(raw: PassReadonly<RawApi>, pointer: string): Origin | undefined {
  if (jsonAtPointer(raw.merged, pointer) === undefined) return undefined;
  const origins = raw.leafOrigins;

  for (let at = pointer; ; at = at.slice(0, at.lastIndexOf("/"))) {
    if (Object.hasOwn(origins, at)) {
      const origin = origins[at] as PassReadonly<Origin>;

      return originCopy(origin, origin.pointer + pointer.slice(at.length));
    }

    if (at === "") break;
  }

  for (let i = raw.layers.length - 1; i >= 0; i--) {
    const layer = raw.layers[i];

    if (layer !== undefined && jsonAtPointer(layer.tree, pointer) !== undefined)
      return { layer: layer.layer, pointer };
  }

  return undefined;
}

import type { Origin } from "@seampact/spec/ir";
import { derivationFreeze } from "../derivations/freeze.js";
import { derivationRoles } from "../derivations/roles.js";
import type { JsonValue, RawApi } from "../raw-tree.js";
import { isJsonObject, jsonAt, pipelineOrigin, pointerBelow } from "./pointer.js";
import type { PassReadonly } from "./readonly.js";

// The conventions a pass reads (ADR 0002 section 13, ADR 0006 section 2): the merged `conventions` of the api's
// layers, each value with the origin of the layer that wrote it, or the core default with no origin. The IR
// `conventions` map lists only written conventions, so a default never reaches it with a made-up origin.

/** A convention value: written (with its origin) or the core default (no origin). */
export interface ConventionReading {
  /** The raw value (read-only when the raw tree is), or the frozen default. */
  readonly value: PassReadonly<JsonValue>;
  /** Absent for a core default of ADR 0002 section 13. */
  readonly origin?: Origin;
}

export interface ResolvedConventions {
  /**
   * The value at a dotted path under `conventions` (`bodyLimit`, `idempotency.header`, `errors.derived.notFound`),
   * or its core default; undefined when neither is set. Read a leaf: a written object is returned as written, with
   * no default filled in below it, and the origin of an object several layers write into is the last of them.
   */
  get(path: string): ConventionReading | undefined;
}

/**
 * One core default of ADR 0002 section 13, at a leaf path: a value, or another key's reading (`from`, which then
 * carries that key's origin). `within` limits a default to a convention that is written at all: the defaults of
 * `idempotency` apply only when `idempotency` is set, since an unset `idempotency` derives no key.
 */
export type PipelineConventionDefault =
  | { readonly path: string; readonly value: PassReadonly<JsonValue>; readonly within?: string }
  | { readonly path: string; readonly from: string };

// The `ops` table of ADR 0002 section 6: method, path relative to the op's scope, success status.
const OPS = [
  ["list", "get", "", 200],
  ["get", "get", "", 200],
  ["create", "post", "", 201],
  ["update", "patch", "", 200],
  ["delete", "delete", "", 204],
  ["batch", "post", "batch", 200],
] as const;

/**
 * The core defaults of ADR 0002 section 13, deep-frozen; a key without a default (`paging.default`, `rateLimit`,
 * `idempotency.header`) is absent.
 */
export const pipelineConventionDefaults: readonly PipelineConventionDefault[] = derivationFreeze<
  PipelineConventionDefault[]
>([
  { path: "format", value: "bare" },
  { path: "pathCase", value: "kebab" },
  { path: "paging.defaultLimit", from: "paging.maxLimit" },
  { path: "paging.overLimit", value: "reject" },
  { path: "idempotency.methods", value: ["post", "put", "patch", "delete"], within: "idempotency" },
  { path: "idempotency.required", value: true, within: "idempotency" },
  { path: "idempotency.enforce", value: "boundary", within: "idempotency" },
  { path: "bodyLimit", value: "1MiB" },
  { path: "batch.bodyLimit", from: "bodyLimit" },
  { path: "cache.families", value: {} },
  { path: "restrictedInput", value: "reject" },
  { path: "outputEnums", value: "enum" },
  { path: "pathVersion", value: "prefix" },
  { path: "query.lists", value: "repeat" },
  { path: "query.objects", value: "explode" },
  { path: "query.unknownKeys", value: "refuse" },
  { path: "input.unknownKeys", value: "refuse" },
  { path: "int64", value: "string" },
  { path: "deprecation.header", value: "Deprecation" },
  { path: "deprecation.sunsetHeader", value: "Sunset" },
  { path: "deprecation.successorRel", value: "successor-version" },
  ...OPS.flatMap(([op, method, path, status]) => [
    { path: `ops.${op}.method`, value: method },
    { path: `ops.${op}.path`, value: path },
    { path: `ops.${op}.status`, value: status },
  ]),
  { path: "operationIds.order", value: "verbNoun" },
  { path: "operationIds.case", value: "camel" },
  { path: "urls", value: "relative" },
  { path: "errors.every", value: [] },
  { path: "errors.reach", value: "subtree" },
  // A34: each role is bound to its default code (ADR 0006 section 6) unless a layer binds it.
  ...derivationRoles.map((role) => ({
    path: `errors.derived.${role.role}`,
    value: role.defaultCode,
  })),
]);

const DEFAULTS = new Map(pipelineConventionDefaults.map((d) => [d.path, d]));

/** The conventions of one api: written values with their origins, else the core defaults. Readings are frozen. */
export function pipelineConventions(raw: PassReadonly<RawApi>): ResolvedConventions {
  const written = raw.merged.conventions;
  // `depth` bounds a chain of `from` defaults, so a table mistake cannot loop.
  const get = (path: string, depth: number): ConventionReading | undefined => {
    const segments = path.split(".");
    const value = isJsonObject(written) ? jsonAt(written, segments) : undefined;
    if (value !== undefined) {
      const origin = pipelineOrigin(raw, pointerBelow("/conventions", ...segments));
      return Object.freeze(
        origin === undefined ? { value } : { value, origin: Object.freeze(origin) },
      );
    }
    const fallback = DEFAULTS.get(path);
    if (fallback === undefined || depth > DEFAULTS.size) return undefined;
    if ("from" in fallback) return get(fallback.from, depth + 1);
    if (fallback.within !== undefined && get(fallback.within, depth + 1) === undefined)
      return undefined;
    return Object.freeze({ value: fallback.value });
  };
  return Object.freeze({ get: (path: string) => get(path, 0) });
}

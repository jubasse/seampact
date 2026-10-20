import { authoringSchemas } from "@seampact/spec/authoring";
import type { Origin } from "@seampact/spec/ir";
import { derivationFreeze } from "../derivations/freeze.js";
import { type DerivationRoleName, derivationRoles } from "../derivations/roles.js";
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

// The `ops` table of ADR 0002 section 6: method, path relative to the op's scope, success status.
const OPS = [
  ["list", "get", "", 200],
  ["get", "get", "", 200],
  ["create", "post", "", 201],
  ["update", "patch", "", 200],
  ["delete", "delete", "", 204],
  ["batch", "post", "batch", 200],
] as const;

type ConventionOp = (typeof OPS)[number][0];

// The leaves of the conventions authoring schema but the `ops` ones; a test keeps them equal to the schema's.
const LEAVES = [
  "format",
  "pathCase",
  "paging.default",
  "paging.maxLimit",
  "paging.defaultLimit",
  "paging.overLimit",
  "idempotency.header",
  "idempotency.replayHeader",
  "idempotency.lifetime",
  "idempotency.methods",
  "idempotency.required",
  "idempotency.enforce",
  "bodyLimit",
  "batch.maxIds",
  "batch.bodyLimit",
  "batch.budget",
  "cache.families",
  "cache.sensitiveElsewhere",
  "restrictedInput",
  "outputEnums",
  "pathVersion",
  "query.lists",
  "query.objects",
  "query.unknownKeys",
  "input.unknownKeys",
  "int64",
  "deprecation.header",
  "deprecation.sunsetHeader",
  "deprecation.successorRel",
  "operationIds.order",
  "operationIds.case",
  "rateLimit.header",
  "rateLimit.param",
  "rateLimit.unit",
  "degradedHeader",
  "urls",
  "rights.pattern",
  "service.allowPublic",
  "access.guestRule",
  "errors.pattern",
  "errors.every",
  "errors.reach",
  "errors.derived",
] as const;

/**
 * A path `ResolvedConventions.get` reads: a leaf of the conventions authoring schema (a value, a list or a map),
 * or one entry of a map leaf (`errors.derived.<role>`, `cache.families.<name>`).
 */
export type ConventionPath =
  | (typeof LEAVES)[number]
  | `ops.${ConventionOp}.${"method" | "path" | "status"}`
  | `errors.derived.${DerivationRoleName}`
  | `cache.families.${string}`;

/** Every leaf `ConventionPath` names, map entries aside; a test keeps it equal to the schema's leaves. */
export const pipelineConventionLeaves: readonly ConventionPath[] = Object.freeze([
  ...LEAVES,
  ...OPS.flatMap(([op]) => [
    `ops.${op}.method` as const,
    `ops.${op}.path` as const,
    `ops.${op}.status` as const,
  ]),
]);

export interface ResolvedConventions {
  /**
   * The value at a dotted path under `conventions` (`bodyLimit`, `idempotency.header`, `errors.derived.notFound`),
   * or its core default; undefined when neither is set. A map leaf (`cache.families`) is returned as written, and
   * the origin of a map several layers write into is the last of them. A path that is no leaf of the conventions
   * schema, nor an entry of a map leaf, throws (a typo, or an object such as `idempotency`), whatever `path`'s type.
   */
  get(path: ConventionPath): ConventionReading | undefined;
}

/**
 * One core default of ADR 0002 section 13, at a leaf path: a value, or another key's reading (`from`, which then
 * carries that key's origin). `within` limits a default to a convention that is written at all: the defaults of
 * `idempotency` apply only when `idempotency` is set, since an unset `idempotency` derives no key.
 */
export type PipelineConventionDefault =
  | {
      readonly path: ConventionPath;
      readonly value: PassReadonly<JsonValue>;
      /** A top-level convention (an object), which must be written for the default to apply. */
      readonly within?: string;
    }
  | { readonly path: ConventionPath; readonly from: ConventionPath };

/** The `cache.sensitiveElsewhere` value that refuses a sensitive value outside a body field; the default is `noStore`. */
export const SENSITIVE_ELSEWHERE_REFUSE = "refuse";

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
  { path: "cache.sensitiveElsewhere", value: "noStore" },
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
  ...OPS.flatMap(([op, method, path, status]): PipelineConventionDefault[] => [
    { path: `ops.${op}.method`, value: method },
    { path: `ops.${op}.path`, value: path },
    { path: `ops.${op}.status`, value: status },
  ]),
  { path: "operationIds.order", value: "verbNoun" },
  { path: "operationIds.case", value: "camel" },
  { path: "urls", value: "relative" },
  { path: "service.allowPublic", value: false },
  { path: "access.guestRule", value: "refuse" },
  { path: "errors.every", value: [] },
  { path: "errors.reach", value: "subtree" },
  // A34: each role is bound to its default code (ADR 0006 section 6) unless a layer binds it.
  ...derivationRoles.map(
    (role): PipelineConventionDefault => ({
      path: `errors.derived.${role.role}`,
      value: role.defaultCode,
    }),
  ),
]);

const DEFAULTS = new Map<string, PipelineConventionDefault>(
  pipelineConventionDefaults.map((d) => [d.path, d]),
);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let schemaLeaves: ReadonlyMap<string, RegExp | undefined> | undefined;

/**
 * The leaves of the conventions authoring schema (`@seampact/spec/authoring`), each with the key pattern of its
 * entries when it is a map: a closed object is walked into, anything else is a leaf.
 */
export function pipelineConventionSchemaLeaves(): ReadonlyMap<string, RegExp | undefined> {
  if (schemaLeaves !== undefined) return schemaLeaves;
  const leaves = new Map<string, RegExp | undefined>();
  const walk = (schema: unknown, prefix: string): void => {
    const properties = isRecord(schema) ? schema.properties : undefined;

    if (!isRecord(properties)) return;

    for (const [key, item] of Object.entries(properties)) {
      if (key === "$include" || !isRecord(item)) continue;
      const path = prefix === "" ? key : `${prefix}.${key}`;

      if (item.type === "object" && item.additionalProperties === false) walk(item, path);
      else {
        const names = item.propertyNames;
        const pattern = isRecord(names) ? names.pattern : undefined;

        leaves.set(path, typeof pattern === "string" ? new RegExp(pattern) : undefined);
      }
    }
  };

  const defs = authoringSchemas().conventions.$defs;

  walk(isRecord(defs) ? defs.conventions : undefined, "");

  if (leaves.size === 0) throw new Error("the conventions authoring schema has no leaf");
  schemaLeaves = leaves;

  return leaves;
}

// Whether `path` is a schema leaf, or one entry of a map leaf whose key its pattern accepts.
function isConventionPath(path: string): boolean {
  const leaves = pipelineConventionSchemaLeaves();

  if (leaves.has(path)) return true;
  const dot = path.lastIndexOf(".");
  const entries = dot === -1 ? undefined : leaves.get(path.slice(0, dot));
  const key = path.slice(dot + 1);

  return entries !== undefined && key !== "$include" && entries.test(key);
}

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

  return Object.freeze({
    get: (path: ConventionPath) => {
      if (!isConventionPath(path))
        throw new Error(
          `conventions.${path} is no leaf of the conventions schema (ADR 0002 section 13): read a leaf such as ` +
            "bodyLimit or idempotency.header, or an entry such as errors.derived.notFound",
        );

      return get(path, 0);
    },
  });
}

/** The param `conventions.rateLimit` names for `rateLimited`'s delay, if any. */
export function pipelineRateLimitParam(conventions: ResolvedConventions): string | undefined {
  const param = conventions.get("rateLimit.param")?.value;

  return typeof param === "string" ? param : undefined;
}

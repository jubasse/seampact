import type { ContractIR, Origin } from "@seampact/spec/ir";
import type { JsonValue, RawApi } from "../raw-tree.js";
import { isJsonObject, pipelineOrigin, pointerBelow } from "./pointer.js";
import type { PassReadonly } from "./readonly.js";

// The declarations an api's layers write and whether the contract reaches each, for the lint rule that reports the
// unused ones: finalize drops an unreached entry from the IR (ADR 0004 section 2), so only the merged raw
// catalogues still list it.

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

// Catalogues whose uses finalize cannot see: a scalar, array or enum use schema is inlined at each use (ADR 0007
// section 3) and a requirement expands into each route's `requires`, so the IR never holds either entry.
const INLINED_CATALOGUES: ReadonlySet<string> = new Set(["schemas", "requirements"]);

const DECLARED_CATALOGUE_NAMES: ReadonlySet<string> = new Set(DECLARED_CATALOGUES);

const CONVENTIONS_MEMBER = "conventions";

export interface PipelineDeclared {
  readonly catalogue: string;
  readonly id: string;
  /** Where the winning layer wrote the entry. */
  readonly origin: Origin;
  /** Whether an operation, an identity or a convention reaches the entry, through an inlined use included. */
  readonly reached: boolean;
}

/**
 * Every entry of the api's merged catalogues, in catalogue then key order, with its winning layer's origin and
 * whether `ir`, the finalized IR, reaches it.
 */
export function pipelineDeclared(raw: PassReadonly<RawApi>, ir: ContractIR): PipelineDeclared[] {
  const reachedInline = inlinedEntriesReached(raw, ir);
  const conventionNames = stringsOf(raw.merged[CONVENTIONS_MEMBER]);
  const declared: PipelineDeclared[] = [];

  for (const catalogue of DECLARED_CATALOGUES) {
    const entries = raw.merged[catalogue];

    if (!isJsonObject(entries)) continue;

    for (const id of Object.keys(entries)) {
      const origin = pipelineOrigin(raw, pointerBelow(`/${catalogue}`, id));

      if (origin === undefined)
        throw new Error(`the ${catalogue} entry ${id} of api ${raw.name} has no origin`);
      const reached =
        irHolds(ir, catalogue, id) ||
        conventionNames.has(id) ||
        reachedInline.has(entryKey(catalogue, id));

      declared.push({ catalogue, id, origin, reached });
    }
  }

  return declared;
}

// Finalize keeps exactly the entries its reach walk reaches (`finalize/prune.ts`), so the IR holds a reached one.
function irHolds(ir: ContractIR, catalogue: string, id: string): boolean {
  const entries: unknown = Reflect.get(ir, catalogue);

  return typeof entries === "object" && entries !== null && Object.hasOwn(entries, id);
}

const entryKey = (catalogue: string, id: string): string => JSON.stringify([catalogue, id]);

/**
 * The inlined entries the contract reaches, as entry keys: an entry is reached when its id is a string value of a
 * reached part of the raw tree, which is every member outside the catalogues, every entry the IR holds and every
 * inlined entry reached, to a fixed point. A docs or example string equal to an id also counts as a use.
 */
function inlinedEntriesReached(raw: PassReadonly<RawApi>, ir: ContractIR): Set<string> {
  const reached = new Set<string>();
  const pending: PassReadonly<JsonValue>[] = [];

  for (const [member, value] of Object.entries(raw.merged)) {
    if (!DECLARED_CATALOGUE_NAMES.has(member)) {
      pending.push(value);
      continue;
    }

    if (!isJsonObject(value)) continue;

    for (const [id, entry] of Object.entries(value))
      if (irHolds(ir, member, id)) pending.push(entry);
  }

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const name of stringsOf(next)) pending.push(...newlyReachedEntries(raw, name, reached));
  }

  return reached;
}

// The raw values of the inlined entries `name` names that were not reached yet, marked reached.
function newlyReachedEntries(
  raw: PassReadonly<RawApi>,
  name: string,
  reached: Set<string>,
): PassReadonly<JsonValue>[] {
  const values: PassReadonly<JsonValue>[] = [];

  for (const catalogue of INLINED_CATALOGUES) {
    const entries = raw.merged[catalogue];
    const key = entryKey(catalogue, name);

    if (!isJsonObject(entries) || !Object.hasOwn(entries, name) || reached.has(key)) continue;
    const entry = entries[name];

    reached.add(key);

    if (entry !== undefined) values.push(entry);
  }

  return values;
}

/** Every string value under `value`, keys excluded. */
function stringsOf(value: PassReadonly<JsonValue> | undefined): Set<string> {
  const strings = new Set<string>();
  const pending = value === undefined ? [] : [value];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === "string") strings.add(next);
    else if (Array.isArray(next)) pending.push(...next);
    else if (isJsonObject(next)) pending.push(...Object.values(next));
  }

  return strings;
}

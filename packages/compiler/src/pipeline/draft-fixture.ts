import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JsonObject, JsonValue } from "../raw-tree.js";
import { createDraftIR, type DraftIR } from "./draft.js";
import { createDraftValidator, type DraftValidator } from "./draft-schema.js";
import { type HalfName, pipelineHalves } from "./halves.js";

// Test support, outside every barrel: the two hand-written draft-IR fixtures of the reference contract (ADR 0006
// section 2), `fixtures/draft/reference/`. They are the contract between the passes: each pass's golden tests start
// from the fixture before it.
//
// Per api, two files, each keyed by half in run order, each half's members as it writes them:
// - `<api>.after-tree.json`: `tree.schemas` and `tree.nodes`; tree.nodes' `operations` is the list it creates;
// - `<api>.access-delta.json`: `access.identity` and `access.rights`; `operations` is keyed by operation id, each
//   entry the members the half adds to that operation.
// `draftFixture` applies them, in run order, to a new draft (`createDraftIR`), with `draftFixtureApply`.

/** The apis of the reference contract. */
export type DraftFixtureApi = "tasks" | "tasksService";

/** The draft after tree, or after tree and access. */
export type DraftFixtureStage = "after-tree" | "after-access";

/** A fixture file. */
export type DraftFixtureFile = "after-tree" | "access-delta";

/** One half's members in a fixture file. */
export interface DraftFixtureHalf {
  half: HalfName;
  members: JsonObject;
}

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/draft/reference/", import.meta.url));

const FILES_OF_STAGE: Record<DraftFixtureStage, readonly DraftFixtureFile[]> = {
  "after-tree": ["after-tree"],
  "after-access": ["after-tree", "access-delta"],
};

// The members of `operations` in a delta are keyed by operation id, every other list's by index.
const OPERATIONS = "operations";

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  isObject(value) && !Array.isArray(value);

const isHalfName = (name: string): name is HalfName => pipelineHalves.some((half) => half === name);

const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);

/** The halves of a fixture file, in run order. */
export function draftFixtureHalves(
  api: DraftFixtureApi,
  file: DraftFixtureFile,
): DraftFixtureHalf[] {
  const path = `${FIXTURES}${api}.${file}.json`;
  const parsed: JsonValue = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonObject(parsed)) throw new Error(`${path}: a fixture file is an object keyed by half`);

  const halves: DraftFixtureHalf[] = [];
  for (const [name, members] of Object.entries(parsed)) {
    if (!isHalfName(name))
      throw new Error(`${path}: '${name}' is no half (${pipelineHalves.join(", ")})`);
    if (!isJsonObject(members)) throw new Error(`${path}: the members of ${name} are an object`);
    halves.push({ half: name, members });
  }

  const order = halves.map(({ half }) => pipelineHalves.indexOf(half));
  if (order.some((position, index) => index > 0 && position <= (order[index - 1] ?? -1)))
    throw new Error(`${path}: the halves are listed once each, in run order`);

  return halves;
}

let validator: DraftValidator | undefined;

/** The draft of `api` at `stage`, checked against the derived draft form. */
export function draftFixture(api: DraftFixtureApi, stage: DraftFixtureStage): DraftIR {
  const draft = createDraftIR();
  for (const file of FILES_OF_STAGE[stage])
    for (const { members } of draftFixtureHalves(api, file)) draftFixtureApply(draft, members);

  validator ??= createDraftValidator();
  const report = validator.validate(draft);
  if (!report.valid)
    throw new Error(
      `the ${stage} draft fixture of ${api} does not fit the draft form: ${JSON.stringify(report)}`,
    );

  return draft;
}

/**
 * Adds a half's members to a draft (a guarded one in the ownership test): an absent member is set, an object is
 * merged member by member, a list is appended to, and an object over a list names the elements it merges into,
 * by operation id under `operations` and by index elsewhere. A member already set is never replaced: that throws.
 */
export function draftFixtureApply(draft: object, members: JsonObject): void {
  mergeObject(draft, members, "");
}

function mergeObject(target: object, members: JsonObject, path: string): void {
  for (const [key, value] of Object.entries(members)) {
    const at = join(path, key);
    if (!Object.hasOwn(target, key)) {
      // Defined, not assigned: a `__proto__` key stays a member, and a refusal throws instead of doing nothing.
      Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      continue;
    }

    const present: unknown = Reflect.get(target, key);
    if (Array.isArray(present)) mergeList(present, value, at);
    else if (isObject(present) && isJsonObject(value)) mergeObject(present, value, at);
    else
      throw new Error(
        `draftFixtureApply: ${at} is already set; a half adds members, never replaces one`,
      );
  }
}

function mergeList(list: unknown[], value: JsonValue, path: string): void {
  if (Array.isArray(value)) {
    for (const item of value) list.push(item);
    return;
  }

  if (!isJsonObject(value))
    throw new Error(
      `draftFixtureApply: ${path} is a list; a half appends a list or merges an object`,
    );

  for (const [key, members] of Object.entries(value)) {
    const element = path === OPERATIONS ? operationById(list, key) : list[Number(key)];
    if (!isObject(element) || !isJsonObject(members))
      throw new Error(
        `draftFixtureApply: ${join(path, key)} names no element to merge an object into`,
      );
    mergeObject(element, members, join(path, key));
  }
}

const operationById = (operations: unknown[], id: string): unknown =>
  operations.find((operation) => isObject(operation) && Reflect.get(operation, "id") === id);

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  IR_AJV_OPTIONS,
  IR_KEYWORDS,
  IR_SCHEMA_ID,
  type IrWriter,
  strictIrSchemas,
} from "@seampact/spec/ir";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { JsonObject, JsonValue } from "../raw-tree.js";
import { createDraftIR, type DraftIR } from "./draft.js";
import { createDraftValidator, type DraftValidator } from "./draft-schema.js";
import { type HalfName, pipelineHalves } from "./halves.js";
import type { TreeSchemaExampleIssue, TreeSchemaService } from "./pass.js";

// Test support, outside every barrel: the two hand-written draft-IR fixtures of the reference contract (ADR 0006
// section 2), `fixtures/draft/reference/`. They are the contract between the passes: each pass's golden tests start
// from the fixture before it.
//
// Per api, two files, each keyed by half in run order, each half's members as it writes them:
// - `<api>.after-tree.json`: `tree.schemas` and `tree.nodes`; tree.nodes' `operations` is the list it creates;
// - `<api>.access-delta.json`: `access.identity` and `access.rights`; `operations` is keyed by operation id, each
//   entry the members the half adds to that operation.
// `draftFixture` applies them, in run order, to a new draft (`createDraftIR`), with `draftFixtureApply`.
//
// `<api>.schema-uses.json` is the schema service of the after-tree state (`draftFixtureSchemaService`), for the
// halves after tree.schemas until its lane lands: the type use of each declared route position tree.nodes reads
// (params, input, response bodies) and of each catalogue position the access halves read, which tests check
// against the after-tree fixture and the access delta, and the query wire of each rule proof schema.

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

const FIXTURES = fileURLToPath(
  new URL("../../../../../fixtures/draft/reference/", import.meta.url),
);

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

/** A raw-tree position whose schema the fixture service answers, and where the fixtures write its use. */
export interface DraftFixtureSchemaUse {
  /** The JSON Pointer of the written schema in the api's merged raw tree. */
  pointer: string;
  direction: IrWriter.Direction;
  use: IrWriter.TypeUse;
  /** The JSON Pointers of the use in the after-access draft; a `SchemaRef` position holds the schema id only. */
  at: string[];
}

/** A rule proof schema position and the query wire the service answers for it. */
export interface DraftFixtureQueryWire {
  /** The JSON Pointer of the proof schema in the api's merged raw tree (`/rules/<id>/proof/schema`). */
  pointer: string;
  wire: IrWriter.QueryWire;
}

/** The tables of `<api>.schema-uses.json`. */
export interface DraftFixtureSchemaTables {
  typeUses: DraftFixtureSchemaUse[];
  queryWires: DraftFixtureQueryWire[];
}

/** An example value holding this string anywhere fails `checkExample` of the fixture service, at that place. */
export const DRAFT_FIXTURE_INVALID_EXAMPLE = "__invalid_example__";

const DIRECTIONS: readonly IrWriter.Direction[] = ["input", "output"];

const isDirection = (value: JsonValue | undefined): value is IrWriter.Direction =>
  DIRECTIONS.some((direction) => direction === value);

let strictAjv: Ajv2020 | undefined;

// A definition of the strict IR schema, so a table row is checked with every member it requires.
function strictDefinition(file: string, name: string): ValidateFunction {
  if (strictAjv === undefined) {
    strictAjv = new Ajv2020({ ...IR_AJV_OPTIONS });
    for (const keyword of IR_KEYWORDS) strictAjv.addKeyword(structuredClone(keyword));
    for (const document of strictIrSchemas()) strictAjv.addSchema(document);
  }

  const ref = `${new URL(file, IR_SCHEMA_ID).href}#/$defs/${name}`;
  const validate = strictAjv.getSchema(ref);
  if (validate === undefined) throw new Error(`the strict IR schema has no definition ${ref}`);
  return validate;
}

const isTypeUse = (value: unknown): value is IrWriter.TypeUse =>
  strictDefinition("schemas.schema.json", "TypeUse")(value) === true;

const isQueryWire = (value: unknown): value is IrWriter.QueryWire =>
  strictDefinition("operation.schema.json", "QueryWire")(value) === true;

/** The tables of `<api>.schema-uses.json`, each row checked against the strict IR definition it holds. */
export function draftFixtureSchemaTables(api: DraftFixtureApi): DraftFixtureSchemaTables {
  const path = `${FIXTURES}${api}.schema-uses.json`;
  const parsed: JsonValue = JSON.parse(readFileSync(path, "utf8"));
  const typeUseRows = isJsonObject(parsed) ? parsed.typeUses : undefined;
  const queryWireRows = isJsonObject(parsed) ? parsed.queryWires : undefined;
  if (!Array.isArray(typeUseRows) || !Array.isArray(queryWireRows))
    throw new Error(`${path}: the file is { typeUses: [...], queryWires: [...] }`);

  const typeUses = typeUseRows.map((row, index) => {
    const { pointer, direction, use, at } = isJsonObject(row) ? row : {};
    const positions = Array.isArray(at)
      ? at.filter((position) => typeof position === "string")
      : [];
    if (typeof pointer !== "string" || !isDirection(direction))
      throw new Error(`${path}: typeUses/${index} needs a string pointer and a direction`);
    if (!Array.isArray(at) || positions.length === 0 || positions.length !== at.length)
      throw new Error(`${path}: typeUses/${index}/at is a non-empty list of JSON Pointers`);
    if (!isTypeUse(use)) throw new Error(`${path}: typeUses/${index}/use is no strict TypeUse`);
    return { pointer, direction, use, at: positions };
  });

  const queryWires = queryWireRows.map((row, index) => {
    const { pointer, wire } = isJsonObject(row) ? row : {};
    if (typeof pointer !== "string")
      throw new Error(`${path}: queryWires/${index} needs a pointer`);
    if (!isQueryWire(wire))
      throw new Error(`${path}: queryWires/${index}/wire is no strict QueryWire`);
    return { pointer, wire };
  });

  return { typeUses, queryWires };
}

/**
 * The schema service of the after-tree state, from `<api>.schema-uses.json`: `typeUse` and `queryWire` answer the
 * listed positions (a fresh copy each time) and nothing else, `queryWire` the rule proof schemas as the real service
 * does (the reference declares no query or form field); `checkExample` finds each `DRAFT_FIXTURE_INVALID_EXAMPLE`.
 */
export function draftFixtureSchemaService(api: DraftFixtureApi): TreeSchemaService {
  const { typeUses, queryWires } = draftFixtureSchemaTables(api);
  return {
    typeUse: (pointer, direction) => {
      const found = typeUses.find(
        (entry) => entry.pointer === pointer && entry.direction === direction,
      );
      return found === undefined ? undefined : structuredClone(found.use);
    },
    queryWire: (pointer) => {
      const found = queryWires.find((entry) => entry.pointer === pointer);
      return found === undefined ? undefined : structuredClone(found.wire);
    },
    checkExample: (value) => invalidExampleMarkers(value, ""),
  };
}

function invalidExampleMarkers(value: unknown, pointer: string): TreeSchemaExampleIssue[] {
  if (value === DRAFT_FIXTURE_INVALID_EXAMPLE)
    return [{ pointer, message: "the example holds the fixture's invalid marker" }];
  if (!isObject(value)) return [];

  return Object.entries(value).flatMap(([key, member]) =>
    invalidExampleMarkers(member, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
  );
}

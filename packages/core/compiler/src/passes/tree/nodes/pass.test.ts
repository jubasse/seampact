import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import {
  type DraftFixtureApi,
  draftFixture,
  draftFixtureHalves,
  draftFixtureSchemaService,
} from "../../../pipeline/draft-fixture.js";
import { createDraftIR, type DraftIR, type TreeSchemaService } from "../../../pipeline/seam.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";
import {
  REFERENCE_CONTRACT,
  treeNodesApiOf,
  treeNodesLoadDirectory,
  treeNodesRun,
} from "./test-support.js";

// The members tree.nodes writes so far; the comparison grows with each member it writes, and the whole after-tree
// comparison lands with the relay routes.
const MEMBERS = [
  "kind",
  "id",
  "name",
  "surface",
  "op",
  "resource",
  "method",
  "path",
  "safe",
  "params",
  "unknownQuery",
  "input",
  "responses",
  "concurrency",
  "owner",
  "paging",
  "degradable",
  "budgetMs",
  "deprecated",
  "upstream",
  "maturity",
  "internal",
  "tags",
  "examples",
  "format",
  "docs",
  "extensions",
  "origin",
] as const;

// Members written later: a relay route's copied shape.
const LATER: Readonly<Record<string, readonly string[]>> = {
  "tasksService:getTask": ["method", "safe", "path", "params", "responses", "format"],
};

// The fixture service has no row for the batch ids input, the schema tree.schemas hoists at the batch op entry.
const BATCH_OP = "/surfaces/app/routes/channels/member/routes/tasks/ops/batch";
const BATCH_INPUT: IrWriter.TypeUse = { kind: "ref", schema: "GetTasksBatchInput" };

function withBatchInput(service: TreeSchemaService): TreeSchemaService {
  return {
    ...service,
    typeUse: (pointer, direction) =>
      pointer === BATCH_OP && direction === "input"
        ? structuredClone(BATCH_INPUT)
        : service.typeUse(pointer, direction),
  };
}

// The api-wide members tree.nodes writes.
const API_MEMBERS = [
  "api",
  "conventions",
  "lint",
  "packs",
  "formats",
  "pagings",
  "services",
] as const;

// Api-wide members written later: the format a relay route copies.
const LATER_API: Readonly<Record<string, readonly string[]>> = {
  tasksService: ["formats"],
};

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;

  if (Array.isArray(value)) return value.every(isJsonValue);

  if (typeof value !== "object") return false;

  return Object.values(value).every(isJsonValue);
}

function treeNodesMembers(api: DraftFixtureApi): JsonObject {
  const half = draftFixtureHalves(api, "after-tree").find(({ half }) => half === "tree.nodes");

  if (half === undefined) throw new Error(`the ${api} fixture has no tree.nodes half`);

  return half.members;
}

// The fixture leaves out an empty catalogue or list; the draft holds every one.
function expectedApiMembers(api: DraftFixtureApi): JsonObject {
  const members = treeNodesMembers(api);

  return {
    api: members.api ?? null,
    conventions: members.conventions ?? {},
    lint: members.lint ?? null,
    packs: members.packs ?? [],
    formats: members.formats ?? {},
    pagings: members.pagings ?? {},
    services: members.services ?? {},
  };
}

function expectedOperations(api: DraftFixtureApi): JsonObject[] {
  const operations = treeNodesMembers(api).operations;

  if (!Array.isArray(operations))
    throw new Error(`the ${api} fixture has no tree.nodes operations`);

  return operations.filter(isObject).map((operation) => pick(api, operation));
}

// The compared members of an operation, from the fixture or the draft.
function pick(api: string, operation: object): JsonObject {
  const members = new Map<string, unknown>(Object.entries(operation));
  const later = LATER[`${api}:${String(members.get("id"))}`] ?? [];
  const picked: JsonObject = {};

  for (const member of MEMBERS) {
    const value: unknown = members.get(member);

    if (value === undefined || later.includes(member)) continue;

    if (!isJsonValue(value))
      throw new Error(`the member ${member} of an operation is no JSON value`);
    picked[member] = value;
  }

  return picked;
}

const workspace = treeNodesLoadDirectory(REFERENCE_CONTRACT, "workspace.yaml");

// The draft as tree.schemas leaves it: the fixture's schemas, which the input checks walk.
function schemasOf(api: DraftFixtureApi): DraftIR {
  const draft = createDraftIR();

  Object.assign(draft.schemas, draftFixture(api, "after-tree").schemas);

  return draft;
}

test.each<DraftFixtureApi>(["tasks", "tasksService"])(
  "tree.nodes matches the after-tree fixture (%s)",
  (api) => {
    const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace, api), workspace, {
      treeSchemas: withBatchInput(draftFixtureSchemaService(api)),
      draft: schemasOf(api),
    });

    expect(diagnostics).toEqual([]);
    const compared = API_MEMBERS.filter((member) => !LATER_API[api]?.includes(member));
    const expected = expectedApiMembers(api);

    expect(Object.fromEntries(compared.map((member) => [member, draft[member] ?? null]))).toEqual(
      Object.fromEntries(compared.map((member) => [member, expected[member]])),
    );
    expect(draft.operations.map((operation) => pick(api, operation))).toEqual(
      expectedOperations(api),
    );
  },
);

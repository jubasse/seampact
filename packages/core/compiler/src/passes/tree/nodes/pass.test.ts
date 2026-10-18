import { expect, test } from "vitest";
import {
  type DraftFixtureApi,
  draftFixture,
  draftFixtureHalves,
  draftFixtureSchemaService,
} from "../../../pipeline/draft-fixture.js";
import { createDraftIR, type DraftIR } from "../../../pipeline/seam.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";
import {
  REFERENCE_CONTRACT,
  treeNodesApiOf,
  treeNodesLoadDirectory,
  treeNodesRelayedTasks,
  treeNodesRun,
  treeNodesWithBatchInput,
} from "./test-support.js";

// Every operation member tree.nodes writes.
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
  "relays",
  "format",
  "docs",
  "extensions",
  "origin",
] as const;

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

  return operations.filter(isObject).map(pick);
}

// The compared members of an operation, from the fixture or the draft.
function pick(operation: object): JsonObject {
  const members = new Map<string, unknown>(Object.entries(operation));
  const picked: JsonObject = {};

  for (const member of MEMBERS) {
    const value: unknown = members.get(member);

    if (value === undefined) continue;

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
      treeSchemas: treeNodesWithBatchInput(draftFixtureSchemaService(api)),
      draft: schemasOf(api),
      relayed: treeNodesRelayedTasks(),
    });

    expect(diagnostics).toEqual([]);
    const expected = expectedApiMembers(api);

    expect(
      Object.fromEntries(API_MEMBERS.map((member) => [member, draft[member] ?? null])),
    ).toEqual(Object.fromEntries(API_MEMBERS.map((member) => [member, expected[member]])));
    expect(draft.operations.map(pick)).toEqual(expectedOperations(api));
  },
);

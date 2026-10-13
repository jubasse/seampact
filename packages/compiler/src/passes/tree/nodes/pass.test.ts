import { expect, test } from "vitest";
import {
  type DraftFixtureApi,
  draftFixtureHalves,
  draftFixtureSchemaService,
} from "../../../pipeline/draft-fixture.js";
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
  "safe",
  "input",
  "origin",
] as const;

// Members written later: a relay route's method (copied from the public operation) and the batch ids input.
const LATER: Readonly<Record<string, readonly string[]>> = {
  "tasksService:getTask": ["method", "safe"],
  "tasks:getTasksBatch": ["input"],
};

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function expectedOperations(api: DraftFixtureApi): JsonObject[] {
  const half = draftFixtureHalves(api, "after-tree").find(({ half }) => half === "tree.nodes");
  const operations = half?.members.operations;
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

test.each<DraftFixtureApi>(["tasks", "tasksService"])(
  "tree.nodes matches the after-tree fixture (%s)",
  (api) => {
    const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace, api), workspace, {
      treeSchemas: draftFixtureSchemaService(api),
    });

    expect(diagnostics).toEqual([]);
    expect(draft.operations.map((operation) => pick(api, operation))).toEqual(
      expectedOperations(api),
    );
  },
);

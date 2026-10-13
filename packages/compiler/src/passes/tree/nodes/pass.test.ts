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

function expectedOperations(api: DraftFixtureApi): JsonObject[] {
  const half = draftFixtureHalves(api, "after-tree").find(({ half }) => half === "tree.nodes");
  const operations = half?.members.operations;
  if (!Array.isArray(operations))
    throw new Error(`the ${api} fixture has no tree.nodes operations`);
  return operations.filter(isObject).map((operation) => pick(api, operation));
}

function pick(api: string, operation: JsonObject | object): JsonObject {
  const id = Reflect.get(operation, "id");
  const later = LATER[`${api}:${String(id)}`] ?? [];
  const picked: JsonObject = {};
  for (const member of MEMBERS) {
    const value: JsonValue | undefined = Reflect.get(operation, member);
    if (value !== undefined && !later.includes(member)) picked[member] = value;
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

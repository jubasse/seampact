import { describe, expect, test } from "vitest";
import { pipelineContext, pipelineTreeNodes } from "../../../pipeline/seam.js";
import { treeNodesBodyLimit } from "../../tree/nodes/index.js";
import { treeNodesStubService } from "../../tree/nodes/test-support.js";
import {
  deriveWireLoadFixture,
  deriveWireOperation,
  deriveWireReferenceWorkspace,
  deriveWireRunContract,
  deriveWireRunReference,
} from "./test-support.js";

const KIB = 1024;
const MIB = 1024 * KIB;

describe("body limits", () => {
  const run = deriveWireRunContract(deriveWireLoadFixture("wire"));
  const limitOf = (id: string): number | undefined =>
    deriveWireOperation(run, id).input?.bodyLimitBytes;

  test("a route's own bodyLimit wins, then the nearest ancestor's, then conventions.bodyLimit", () => {
    expect(run.diagnostics).toEqual([]);
    expect(limitOf("bigNotes")).toBe(20 * MIB);
    expect(limitOf("comments")).toBe(2 * MIB);
    expect(limitOf("notes")).toBe(512 * KIB);
  });

  test("a route without input gets no body limit", () => {
    expect(deriveWireOperation(run, "archive").input).toBeUndefined();
    expect(deriveWireOperation(run, "board").input).toBeUndefined();
  });

  test("a batch op reads conventions.batch.bodyLimit, and a proof-only input gets a limit too", () => {
    const reference = deriveWireRunReference(deriveWireReferenceWorkspace(), "tasks");

    expect(deriveWireOperation(reference, "getTasksBatch").input?.bodyLimitBytes).toBe(2 * MIB);
    expect(deriveWireOperation(reference, "createTask").input?.bodyLimitBytes).toBe(MIB);

    const proofOnly = deriveWireOperation(reference, "purgeTask").input;

    expect(proofOnly?.schema).toEqual({ kind: "ref", schema: "ApiEmptyBody" });
    expect(proofOnly?.bodyLimitBytes).toBe(MIB);
  });
});

describe("body limit resolver is shared", () => {
  test("derive.wire writes the bytes tree.nodes resolves for the same node", () => {
    const workspace = deriveWireLoadFixture("wire");
    const run = deriveWireRunContract(workspace);
    const raw = workspace.apis[0];

    if (raw === undefined) throw new Error("the fixture has no api");

    const context = {
      ...pipelineContext({ raw, workspace, report: () => undefined }),
      treeSchemas: treeNodesStubService({}),
    };
    const nodes = new Map(pipelineTreeNodes(raw).map((node) => [node.pointer, node]));
    let compared = 0;

    for (const operation of run.draft.operations) {
      const node = nodes.get(operation.origin?.pointer ?? "");

      if (operation.input === undefined || node === undefined) continue;

      expect(operation.input.bodyLimitBytes).toBe(treeNodesBodyLimit(node, context)?.bytes);
      compared += 1;
    }

    expect(compared).toBeGreaterThan(3);
  });
});

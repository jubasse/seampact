import { expect, test } from "vitest";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { finalizeAddStandIns } from "../../../finalize/complete-draft.js";
import { finalizeIr } from "../../../finalize/finalize.js";
import { deriveWireLoadFiles, deriveWireRunContract } from "./test-support.js";

const CONTRACT = `
api: { name: lifecycle, version: 1 }
conventions:
  degradedHeader: X-Degraded
schemas:
  Task: { type: object, properties: { id: { type: string }, stats: { type: object, properties: { views: { type: integer } } } }, required: [id] }
surfaces:
  app:
    prefix: /v{version}
    access: { public: "Tasks are public." }
    routes:
      getTask: { method: get, path: 'tasks/{id}', pathParams: { id: { type: string } }, output: Task, degradable: [stats] }
      legacyTask:
        method: get
        path: 'legacy/tasks/{id}'
        pathParams: { id: { type: string } }
        output: Task
        deprecated: { since: '2026-06-01', sunset: '2027-01-31', successor: getTask }
`;

test("a compiled deprecated route and a compiled degradable route hold the IR invariants", () => {
  const workspace = deriveWireLoadFiles({ "api.yaml": CONTRACT.trimStart() });
  const [rawApi] = workspace.apis;
  const run = deriveWireRunContract(workspace);

  if (rawApi === undefined) throw new Error("the inline contract has no api");
  const diagnostics: Diagnostic[] = [];

  expect(run.diagnostics).toEqual([]);

  const finalized = finalizeIr(finalizeAddStandIns(run.draft, "lifecycle"), {
    raw: rawApi,
    report: (diagnostic) => diagnostics.push(diagnostic),
  });

  expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);
  const [getTask, legacyTask] = finalized?.ir.operations ?? [];

  expect(getTask?.degradable?.header).toBe("X-Degraded");
  expect(legacyTask?.deprecated?.successorRel).toBe("successor-version");
  expect(legacyTask?.responses[0]?.headers.map((header) => header.semantic)).toEqual([
    "deprecation",
    "sunset",
    "successorLink",
  ]);
});

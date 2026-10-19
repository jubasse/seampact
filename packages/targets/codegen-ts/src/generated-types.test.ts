import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateOutcome } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import { afterAll, expect, test } from "vitest";
import { readGoldenIr, typeErrorsOf } from "./generated-project.test-support.js";
import { target } from "./index.js";

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-ts-run-"));

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function generateTypes(ir: ContractIR): Promise<GenerateOutcome> {
  return target.generate({ ir, options: {}, links: {}, artefacts: new Set(["types"]) });
}

test("the handler output leaves out the 304 that the boundary answers for an ETag", async () => {
  const outcome = await generateTypes(readGoldenIr("tasks"));

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const probe = [
    'import type { GetPreferencesOutput } from "./generated/operations/output.js";',
    "export const handlerStatus: GetPreferencesOutput['status'] = 200;",
    "// @ts-expect-error the boundary answers the 304, not the handler",
    "export const notModifiedStatus: GetPreferencesOutput['status'] = 304;",
  ].join("\n");

  expect(typeErrorsOf(join(temporaryRoot, "etag"), outcome.files, probe)).toEqual([]);
});

test("a signed sort parameter takes the declared keys and their descending forms only", async () => {
  const outcome = await generateTypes(readGoldenIr("tasks"));

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const probe = [
    'import type { ListTasksInput } from "./generated/operations/input.js";',
    'export const declaredSort: ListTasksInput["query"]["sort"] = ["createdAt", "-createdAt"];',
    "// @ts-expect-error title is no sort key of listTasks",
    'export const undeclaredSort: ListTasksInput["query"]["sort"] = ["title"];',
  ].join("\n");

  expect(typeErrorsOf(join(temporaryRoot, "sort"), outcome.files, probe)).toEqual([]);
});

test("a response header the route writes itself is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const operationIndex = ir.operations.findIndex((operation) => operation.id === "createTask");
  const responses = ir.operations[operationIndex]?.responses ?? [];
  const responseIndex = responses.findIndex((response) => response.status === 201);
  const created = responses[responseIndex];

  if (created === undefined) throw new Error("the golden createTask has no 201 response");

  created.headers.push({
    name: "Location",
    required: true,
    type: { kind: "scalar", type: "string", refinements: {} },
  });

  const outcome = await generateTypes(ir);

  expect(outcome).toMatchObject({
    status: "refused",
    refusals: [
      {
        code: "response.header.unsupported",
        member: `/operations/${operationIndex}/responses/${responseIndex}/headers/${created.headers.length - 1}`,
        operation: "createTask",
      },
    ],
  });
});

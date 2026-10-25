import { readFileSync } from "node:fs";
import {
  type GenerateRequest,
  operationLocation,
  planOperation,
  type Refusal,
  withoutRepeats,
} from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR, Template, WireFormat } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";
import { shadowingSiblingPaths, unescapableSegmentRefusals } from "./mock-path.js";
import { errorWritingsOf, mockPlanOf } from "./mock-plan.js";

function packIr(pack: string): ContractIR {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/golden/${pack}/tasks.ir.json`, import.meta.url),
      "utf8",
    ),
  );
}

function typesLinks(ir: ContractIR): GenerateRequest["links"] {
  const exportOf = (role: string) => ({ module: "operations", export: role });

  return {
    types: {
      descriptor: {
        kind: "types",
        style: "typescript",
        schemas: {},
        operations: Object.fromEntries(
          ir.operations.map((operation) => [
            operation.id,
            { input: exportOf("Input"), output: exportOf("Output"), errors: exportOf("Errors") },
          ]),
        ),
      },
      location: { kind: "relative", path: "../types" },
    },
  };
}

function plansOf(ir: ContractIR, refusals: Refusal[]) {
  return ir.operations.map((operation, index) => {
    const location = operationLocation(index, operation.id);

    return mockPlanOf(
      operation,
      operation.id,
      planOperation(operation, ir, location, refusals),
      ir,
      location,
      refusals,
    );
  });
}

test("a page style whose facts the server computes is refused by name, at each member the mock cannot fill", async () => {
  const ir = packIr("pack-laravel");
  const outcome = await target.generate({
    ir,
    options: {},
    links: typesLinks(ir),
    artefacts: new Set(["handlers"]),
  });
  const refusals = outcome.status === "refused" ? outcome.refusals : [];
  const envelope = "/pagings/laravelPages/response/body/members";

  expect(refusals.map((refusal) => `${refusal.code} ${refusal.member}`)).toEqual([
    "mock.page.fact.unsupported /operations/10/paging",
    ...[0, 1, 2, 3].map(
      (member) => `mock.envelope.member.unsupported ${envelope}/1/value/members/${member}/value`,
    ),
    ...[0, 1, 2, 3, 4, 5].map(
      (member) => `mock.envelope.member.unsupported ${envelope}/2/value/members/${member}/value`,
    ),
    "mock.page.fact.unsupported /operations/11/paging",
  ]);
});

const LITERAL_TYPE: Template = { kind: "literal", value: "about:blank" };
const SERVER_SLOT: Template = { kind: "slot", path: [], slot: "instance" };
const CODE_SLOT: Template = { kind: "slot", path: [], slot: "code" };

function withErrorMembers(format: WireFormat): WireFormat {
  return {
    ...format,
    absent: "null",
    error: {
      ...format.error,
      body: {
        kind: "object",
        members: [
          { name: { kind: "text", text: "type" }, value: LITERAL_TYPE },
          { name: { kind: "text", text: "code" }, value: CODE_SLOT },
          { name: { kind: "text", text: "instance" }, value: SERVER_SLOT },
          { name: CODE_SLOT, value: CODE_SLOT },
        ],
      },
    },
  };
}

test("an error body holds its literals and code slots, a server slot as the format's absent, and refuses a slot name", () => {
  const reference = readGoldenIr("tasks");
  const bare = reference.formats.bare;

  if (bare === undefined) throw new Error("the reference contract has no bare format");

  const ir: ContractIR = { ...reference, formats: { bare: withErrorMembers(bare) } };
  const refusals: Refusal[] = [];
  const writings = errorWritingsOf(ir, plansOf(ir, refusals), refusals);

  expect(writings.bare?.["api.not_found"]?.body).toEqual({
    type: "about:blank",
    code: "api.not_found",
    instance: null,
  });
  expect(withoutRepeats(refusals).map((refusal) => `${refusal.code} ${refusal.member}`)).toEqual([
    "mock.error.member.unsupported /formats/bare/error/body/members/3",
  ]);
});

test("a static segment MSW reads as syntax whatever the escape is refused by name", () => {
  const reference = readGoldenIr("tasks");
  const ir: ContractIR = {
    ...reference,
    operations: reference.operations.map((operation) =>
      operation.id === "health" ? { ...operation, path: "/v1/health:2024" } : operation,
    ),
  };

  expect(unescapableSegmentRefusals(ir).map((refusal) => refusal.code)).toEqual([
    "path.segment.literal.unsupported",
  ]);
});

test("a template route lets through the same-method sibling routes that match its URLs first", () => {
  const reference = readGoldenIr("tasks");
  const archiveTask = reference.operations.find((operation) => operation.id === "archiveTask");

  if (archiveTask === undefined) throw new Error("the reference contract has no archiveTask");

  const postOnTask = { ...archiveTask, path: "/v1/channels/{channelId}/tasks/{taskId}" };

  expect(shadowingSiblingPaths(postOnTask, reference)).toEqual([
    "/v1/channels/:channelId/tasks/batch",
    "/v1/channels/:channelId/tasks/search",
  ]);
});

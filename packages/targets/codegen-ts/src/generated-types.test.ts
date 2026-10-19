import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateOutcome } from "@seampact/codegen-core";
import { type ContractIR, isKnownVariant } from "@seampact/spec/ir";
import { afterAll, expect, test } from "vitest";
import { readGoldenIr, typeErrorsOf } from "./generated-project.test-support.js";
import { target } from "./index.js";

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-ts-run-"));

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function generateTypes(ir: ContractIR): Promise<GenerateOutcome> {
  return target.generate({ ir, options: {}, links: {}, artefacts: new Set(["types"]) });
}

test("a nullable opaque property generates as the unknown value it already is", async () => {
  const ir = readGoldenIr("tasks");
  const paymentEvent = ir.schemas.PaymentEvent;
  const property =
    paymentEvent !== undefined &&
    isKnownVariant("Schema", paymentEvent) &&
    paymentEvent.kind === "object"
      ? paymentEvent.properties.find((candidate) => candidate.name === "data")
      : undefined;

  if (property === undefined) throw new Error("the golden PaymentEvent lost its opaque data");
  property.nullable = true;

  const outcome = await generateTypes(ir);

  expect(outcome.status === "generated" ? [] : outcome.refusals).toEqual([]);
});

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

// Sets the sort role of listTasks and the query parameters that style sends, as the compiler would write them.
function generateWithSortRole(
  role: Record<string, string>,
  parameterNames: readonly string[],
): Promise<GenerateOutcome> {
  const ir = readGoldenIr("tasks");
  const operation = ir.operations.find((candidate) => candidate.id === "listTasks");
  const style = ir.pagings[operation?.paging?.style ?? ""];
  const roleIndex = style?.request.findIndex((candidate) => candidate.role === "sort") ?? -1;

  if (style === undefined || roleIndex < 0)
    throw new Error("the golden listTasks has no sort role");

  style.request[roleIndex] = {
    in: "query",
    role: "sort",
    ...role,
  } as (typeof style.request)[number];

  const query = operation?.params.query ?? [];
  const sortParameter = query.find((parameter) => parameter.name === "sort");

  if (operation === undefined || sortParameter === undefined)
    throw new Error("the golden listTasks has no sort parameter");

  const textType = { kind: "scalar", type: "string", refinements: {} } as const;

  operation.params.query = [
    ...query.filter((parameter) => parameter.name !== "sort"),
    ...parameterNames.map((name) => ({
      ...sortParameter,
      name,
      type: name === "sort" && role.style === "pair" ? sortParameter.type : textType,
    })),
  ];

  return generateTypes(ir);
}

async function sortProbeErrors(
  name: string,
  role: Record<string, string>,
  parameterNames: readonly string[],
  probe: string[],
) {
  const outcome = await generateWithSortRole(role, parameterNames);

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const header = 'import type { ListTasksInput } from "./generated/operations/input.js";';

  return typeErrorsOf(join(temporaryRoot, name), outcome.files, [header, ...probe].join("\n"));
}

test("a pair sort parameter takes a declared key and a direction only", async () => {
  const errors = await sortProbeErrors(
    "sort-pair",
    { name: "sort", style: "pair" },
    ["sort"],
    [
      'export const declaredSort: ListTasksInput["query"]["sort"] = ["createdAt,asc", "createdAt,desc"];',
      "// @ts-expect-error title is no sort key of listTasks",
      'export const undeclaredSort: ListTasksInput["query"]["sort"] = ["title,asc"];',
      "// @ts-expect-error the direction is asc or desc",
      'export const undeclaredDirection: ListTasksInput["query"]["sort"] = ["createdAt,up"];',
    ],
  );

  expect(errors).toEqual([]);
});

test("a split sort parameter takes a declared key, its direction parameter asc or desc", async () => {
  const errors = await sortProbeErrors(
    "sort-split",
    { name: "sort", style: "split", direction: "order" },
    ["sort", "order"],
    [
      'export const declaredKey: ListTasksInput["query"]["sort"] = "createdAt";',
      "// @ts-expect-error title is no sort key of listTasks",
      'export const undeclaredKey: ListTasksInput["query"]["sort"] = "title";',
      'export const declaredDirection: ListTasksInput["query"]["order"] = "desc";',
      "// @ts-expect-error the direction is asc or desc",
      'export const undeclaredDirection: ListTasksInput["query"]["order"] = "up";',
    ],
  );

  expect(errors).toEqual([]);
});

test("a keyed sort parameter takes a direction per declared key", async () => {
  const errors = await sortProbeErrors(
    "sort-keyed",
    { name: "sort[{key}]", style: "keyed" },
    ["sort[createdAt]"],
    [
      'export const declaredDirection: ListTasksInput["query"]["sort[createdAt]"] = "asc";',
      "// @ts-expect-error the direction is asc or desc",
      'export const undeclaredDirection: ListTasksInput["query"]["sort[createdAt]"] = "up";',
    ],
  );

  expect(errors).toEqual([]);
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

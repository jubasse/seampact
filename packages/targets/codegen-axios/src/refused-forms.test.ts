import { readFileSync } from "node:fs";
import { readGoldenIr, typesLinks } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR, Template } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target } from "./index.js";

// The axios client is the fetch client over axios, so it refuses by name what the fetch client refuses: the forms
// the client does not read are refused when it is generated, never sent through axios.

type Operation = ContractIR["operations"][number];

const STUDIO_IR = new URL("../../../../fixtures/golden/extensions/studio.ir.json", import.meta.url);

function operationOf(ir: ContractIR, id: string): Operation {
  const operation = ir.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the golden tasks api has no operation '${id}'`);

  return operation;
}

// The client generated from [ir], beside types generated from the unchanged golden api so only the client refuses.
async function refusalsOf(
  ir: ContractIR,
  linked = ir,
): Promise<{ code: string; operation?: string }[]> {
  const outcome = await target.generate({
    ir,
    options: {},
    links: typesLinks(linked),
    artefacts: new Set(["client"]),
  });

  return outcome.status === "refused"
    ? outcome.refusals.map(({ code, operation }) => ({
        code,
        ...(operation === undefined ? {} : { operation }),
      }))
    : [];
}

test("a deprecated operation is refused by name", async () => {
  expect((await refusalsOf(readGoldenIr("tasksResponses"))).map(({ code }) => code)).toContain(
    "deprecated.unsupported",
  );
});

test("a degraded-parts header is refused by name", async () => {
  const ir: ContractIR = JSON.parse(readFileSync(STUDIO_IR, "utf8"));

  expect((await refusalsOf(ir)).map(({ code }) => code)).toContain("degradable.header.unsupported");
});

test("a response header the route writes itself is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const created = operationOf(ir, "createTask").responses.find(({ status }) => status === 201);

  if (created === undefined) throw new Error("the golden createTask has no 201 response");

  created.headers.push({
    name: "Location",
    required: true,
    type: { kind: "scalar", type: "string", refinements: {} },
  });

  expect((await refusalsOf(ir)).map(({ code }) => code)).toContain("response.header.unsupported");
});

test("the rights-version response header of an operator write is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const [success] = operationOf(ir, "updateTask").responses;

  if (success === undefined) throw new Error("the golden tasks api has no updateTask response");

  success.headers.push({
    name: "X-Rights-Version",
    required: false,
    type: { kind: "scalar", type: "string", refinements: {} },
  });

  expect(await refusalsOf(ir)).toContainEqual({
    code: "response.header.unsupported",
    operation: "updateTask",
  });
});

test("an error format that writes the code only inside a text template is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const [format] = Object.values(ir.formats);

  if (format === undefined) throw new Error("the tasks contract declares no format");

  const body: Template = {
    kind: "object",
    members: [
      {
        name: { kind: "text", text: "type" },
        value: {
          kind: "text",
          parts: [
            { kind: "text", text: "https://api.example.com/errors/" },
            { kind: "slot", slot: "code", path: [] },
          ],
        },
      },
    ],
  };

  format.error = { ...format.error, body };

  expect((await refusalsOf(ir)).map(({ code }) => code)).toContain("format.error.body.unsupported");
});

test.each(["application/x-www-form-urlencoded", "multipart/form-data"])(
  "a %s body is refused by name",
  async (media) => {
    const ir = readGoldenIr("tasks");
    const { input } = operationOf(ir, "createTask");

    if (input === undefined) throw new Error("the golden createTask has no body");

    input.media = media;

    expect(await refusalsOf(ir, readGoldenIr("tasks"))).toContainEqual({
      code: "input.media.unsupported",
      operation: "createTask",
    });
  },
);

test("a file download is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const [success] = operationOf(ir, "getTask").responses;

  if (success === undefined) throw new Error("the golden getTask has no response");

  success.shape = "binary";
  success.media = "application/pdf";
  delete success.body;

  expect(await refusalsOf(ir, readGoldenIr("tasks"))).toContainEqual({
    code: "response.shape.unsupported",
    operation: "getTask",
  });
});

test("a query list in brackets form is refused by name", async () => {
  const ir = readGoldenIr("tasks");
  const [list] = operationOf(ir, "listTasks").params.query.filter(
    (param) => param.wire?.kind === "list",
  );

  if (list?.wire === undefined) throw new Error("the golden listTasks has no list query param");

  list.wire.explode = true;
  list.wire.brackets = true;

  expect(await refusalsOf(ir, readGoldenIr("tasks"))).toContainEqual({
    code: "query.list.brackets.unsupported",
    operation: "listTasks",
  });
});

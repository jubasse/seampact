import { readGoldenIr, typesLinks } from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { target as clientTarget } from "./index.js";

type Operation = ContractIR["operations"][number];

// The client sends JSON bodies, reads JSON responses and sends lists comma-separated only, so a form or multipart
// body, a file download and a query list in brackets form (CHK-150, 151, 152, 160) are refused by name.

function operationOf(ir: ContractIR, id: string): Operation {
  const operation = ir.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the golden tasks api has no operation '${id}'`);

  return operation;
}

// The client generated from [ir], beside types generated from the unchanged golden api so only the client refuses.
async function generatedClientOf(ir: ContractIR): ReturnType<typeof clientTarget.generate> {
  return clientTarget.generate({
    ir,
    options: {},
    links: typesLinks(readGoldenIr("tasks")),
    artefacts: new Set(["client"]),
  });
}

test.each(["application/x-www-form-urlencoded", "multipart/form-data"])(
  "a %s body is refused by name",
  async (media) => {
    const ir = readGoldenIr("tasks");
    const { input } = operationOf(ir, "createTask");

    if (input === undefined) throw new Error("the golden createTask has no body");

    input.media = media;

    expect(await generatedClientOf(ir)).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({ code: "input.media.unsupported", operation: "createTask" }),
      ]),
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

  expect(await generatedClientOf(ir)).toMatchObject({
    status: "refused",
    refusals: expect.arrayContaining([
      expect.objectContaining({ code: "response.shape.unsupported", operation: "getTask" }),
    ]),
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

  expect(await generatedClientOf(ir)).toMatchObject({
    status: "refused",
    refusals: expect.arrayContaining([
      expect.objectContaining({ code: "query.list.brackets.unsupported", operation: "listTasks" }),
    ]),
  });
});

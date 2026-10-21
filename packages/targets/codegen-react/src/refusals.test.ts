import type { ClientDescriptor, GenerateRequest } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { expect, test } from "vitest";
import { target } from "./target.js";

const ir = readGoldenIr("tasks");

function clientLink(errorStyle: ClientDescriptor["errorStyle"]): GenerateRequest["links"] {
  const descriptor: ClientDescriptor = {
    kind: "client",
    style: "fetch",
    errorStyle,
    exports: {
      createClient: { module: "index", export: "createClient" },
      Client: { module: "index", export: "Client" },
      ContractError: { module: "index", export: "ContractError" },
      CallOptions: { module: "index", export: "CallOptions" },
    },
    operations: Object.fromEntries(
      ir.operations.map((operation) => [operation.id, { method: operation.id }]),
    ),
  };

  return { client: { descriptor, location: { kind: "relative", path: "../client" } } };
}

async function refusalCodes(
  options: object,
  errorStyle: ClientDescriptor["errorStyle"] = "result",
) {
  const outcome = await target.generate({
    ir,
    options,
    links: clientLink(errorStyle),
    artefacts: new Set(["queries", "hooks"]),
  });

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

test("the libraries of the next release are refused by name", async () => {
  expect(await refusalCodes({ query: "swr" })).toEqual(["options.query.unsupported"]);
});

test("`errors: data` over a throwing client is refused by name, as a throwing client is", async () => {
  expect(await refusalCodes({ query: "tanstack", errors: "data" }, "throw")).toEqual([
    "options.errors.unsupported",
  ]);
  expect(await refusalCodes({ query: "tanstack" }, "throw")).toEqual([
    "link.client.errorStyle.unsupported",
  ]);
});

test("the reference generates its runtime, queries, hooks and index", async () => {
  const outcome = await target.generate({
    ir,
    options: { query: "tanstack" },
    links: clientLink("result"),
    artefacts: new Set(["queries", "hooks"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  expect(outcome.files.map((file) => file.path)).toEqual([
    "hooks.ts",
    "index.ts",
    "queries.ts",
    "query-runtime.ts",
  ]);
});

test("without hooks and itemsOf the index re-exports the queries and the runtime types only", async () => {
  const outcome = await target.generate({
    ir,
    options: { query: "tanstack" },
    links: clientLink("result"),
    artefacts: new Set(["queries"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const index = outcome.files.find((file) => file.path === "index.ts")?.contents ?? "";

  expect(index).not.toContain("hooks");
  expect(index).not.toMatch(/export \{\s*\}/);
});

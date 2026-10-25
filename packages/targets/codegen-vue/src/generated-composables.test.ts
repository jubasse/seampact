import type { ClientDescriptor, GenerateRequest } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { expect, test } from "vitest";
import { target } from "./target.js";

// One golden per mode: the generated `queries.ts` and `composables.ts` of the reference `tasks` api, with the header
// and formatting the CLI writes. The consumer overlays type-check and run the same output in a browser.

const ir = readGoldenIr("tasks");
const GOLDEN_DIRECTORY = "../golden";

const descriptor: ClientDescriptor = {
  kind: "client",
  style: "fetch",
  errorStyle: "result",
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
const links: GenerateRequest["links"] = {
  client: { descriptor, location: { kind: "relative", path: "../client" } },
};

async function formattedModules(query: string): Promise<Map<string, string>> {
  const outcome = await target.generate({
    ir,
    options: { query },
    links,
    artefacts: new Set(["queries", "composables"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  return new Map(outcome.files.map((file) => [file.path, file.contents]));
}

test.each(["tanstack", "fetch"])(
  "`query: %s` generates its golden queries and composables",
  async (query) => {
    const modules = await formattedModules(query);

    expect([...modules.keys()].sort()).toEqual([
      "composables.ts",
      "index.ts",
      "queries.ts",
      "query-runtime.ts",
    ]);
    await expect(modules.get("queries.ts")).toMatchFileSnapshot(
      `${GOLDEN_DIRECTORY}/${query}/queries.ts.golden`,
    );
    await expect(modules.get("composables.ts")).toMatchFileSnapshot(
      `${GOLDEN_DIRECTORY}/${query}/composables.ts.golden`,
    );
  },
);

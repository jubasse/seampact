import type { ClientDescriptor, GenerateRequest } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { expect, test } from "vitest";
import { target } from "./target.js";

// The golden `service.ts` and `http-client-fetch.ts` of the reference `tasks` api, with the header and formatting the
// CLI writes; `queries.ts` is the shared plain fetch module, golden in the vue target. The consumer overlays
// type-check and run the same output in a browser.

const ir = readGoldenIr("tasks");
const GOLDEN_DIRECTORY = "../golden/fetch";

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

test("`query: fetch` generates its golden service and HttpClient fetch", async () => {
  const outcome = await target.generate({
    ir,
    options: { query: "fetch" },
    links,
    artefacts: new Set(["queries", "service"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const modules = new Map(outcome.files.map((file) => [file.path, file.contents]));

  expect([...modules.keys()].sort()).toEqual([
    "http-client-fetch.ts",
    "index.ts",
    "queries.ts",
    "query-runtime.ts",
    "service.ts",
  ]);
  await expect(modules.get("service.ts")).toMatchFileSnapshot(
    `${GOLDEN_DIRECTORY}/service.ts.golden`,
  );
  await expect(modules.get("http-client-fetch.ts")).toMatchFileSnapshot(
    `${GOLDEN_DIRECTORY}/http-client-fetch.ts.golden`,
  );
});

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
  artefacts: ReadonlySet<string> = new Set(["queries", "hooks"]),
) {
  const outcome = await target.generate({
    ir,
    options,
    links: clientLink(errorStyle),
    artefacts,
  });

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

test("SWR and RTK Query refuse `staleTime: contract`, RTK Query `keys.root`, by name", async () => {
  expect(await refusalCodes({ query: "swr", staleTime: "contract" })).toEqual([
    "options.staleTime.unsupported",
  ]);
  expect(
    await refusalCodes({ query: "rtk", staleTime: "contract", keys: { root: "app" } }),
  ).toEqual(["options.staleTime.unsupported", "options.keys.root.unsupported"]);
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

test("SWR and plain fetch generate queries and hooks, RTK Query one api module, each beside the runtime and an index", async () => {
  const pathsOf = async (query: string) => {
    const outcome = await target.generate({
      ir,
      options: { query },
      links: clientLink("result"),
      artefacts: new Set(["queries", "hooks"]),
    });

    if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

    return outcome.files.map((file) => file.path);
  };

  expect(await pathsOf("swr")).toEqual(["hooks.ts", "index.ts", "queries.ts", "query-runtime.ts"]);
  expect(await pathsOf("rtk")).toEqual(["api.ts", "index.ts", "query-runtime.ts"]);
  expect(await pathsOf("fetch")).toEqual([
    "hooks.ts",
    "index.ts",
    "queries.ts",
    "query-runtime.ts",
  ]);
});

test("plain fetch refuses `itemsOf` by name: it has no infinite query", async () => {
  expect(
    await refusalCodes({ query: "fetch" }, "result", new Set(["queries", "hooks", "itemsOf"])),
  ).toEqual(["artefacts.itemsOf.unsupported"]);
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

test("a missing client link is refused, naming the fetch client provider", async () => {
  const outcome = await target.generate({
    ir,
    options: { query: "tanstack" },
    links: {},
    artefacts: new Set(["queries"]),
  });

  expect(
    outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.fix) : [],
  ).toEqual(["Link `@seampact/codegen-fetch` in the target's `link` entry."]);
});

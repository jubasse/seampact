import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientDescriptor, GenerateRequest } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import ts from "typescript";
import { expect, test } from "vitest";
import { target } from "./target.js";

// The golden `service.ts` and `http-client-fetch.ts` of the reference `tasks` api, with the header and formatting the
// CLI writes; `queries.ts` is the shared plain fetch module, golden in the vue target. The consumer overlays
// type-check and run the same output in a browser.

const ir = readGoldenIr("tasks");
// Under the package's git-ignored `.vitest/`, so the generated imports resolve to the package's Angular and NgRx.
const SIGNALS_PROJECT = fileURLToPath(new URL("../.vitest/ngrx-signals-names/", import.meta.url));
const SIGNALS_MODULE = "front/ngrx-signals.ts";
// A client every operation of which takes an optional request and answers a success or a failure, in place of the
// generated client, so the test compiles the angular output alone.
const STUB_CLIENT = `export interface CallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export type Answer =
  | { readonly ok: true; readonly status: 200; readonly headers: Headers; readonly body: string }
  | { readonly ok: false; readonly status: 500; readonly headers: Headers; readonly body: string };
export type Client = Readonly<
  Record<
    string,
    (request?: { readonly headers?: Readonly<Record<string, string>> }, options?: CallOptions) => Promise<Answer>
  >
>;
export declare class ContractError<Id extends string, Failure> extends Error {
  constructor(operationId: Id, failure: Failure);
}
export declare function createClient(config: {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly idempotencyKey?: () => string;
}): Client;
`;
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

test("`state: ngrx` adds its golden action groups and effects, exported from the index", async () => {
  const outcome = await target.generate({
    ir,
    options: { query: "fetch", state: "ngrx" },
    links,
    artefacts: new Set(["queries", "service"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const modules = new Map(outcome.files.map((file) => [file.path, file.contents]));

  expect(modules.get("index.ts")).toContain('export * from "./ngrx.js";');
  await expect(modules.get("ngrx.ts")).toMatchFileSnapshot("../golden/ngrx/ngrx.ts.golden");
});

test("`state: ngrx-signals` adds its golden Signal Store features, exported from the index", async () => {
  const outcome = await target.generate({
    ir,
    options: { query: "fetch", state: "ngrx-signals" },
    links,
    artefacts: new Set(["queries", "service"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  const modules = new Map(outcome.files.map((file) => [file.path, file.contents]));

  expect(modules.has("ngrx.ts")).toBe(false);
  expect(modules.get("index.ts")).toContain('export * from "./ngrx-signals.js";');
  await expect(modules.get("ngrx-signals.ts")).toMatchFileSnapshot(
    "../golden/ngrx-signals/ngrx-signals.ts.golden",
  );
});

test("`state: ngrx-signals` refuses an operation whose store member another operation's feature adds", async () => {
  const renamed = {
    ...ir,
    operations: ir.operations.map((operation) =>
      operation.id === "getTask" ? { ...operation, id: "sendListTasks" } : operation,
    ),
  };
  const renamedDescriptor: ClientDescriptor = {
    ...descriptor,
    operations: Object.fromEntries(
      renamed.operations.map((operation) => [operation.id, { method: operation.id }]),
    ),
  };

  const outcome = await target.generate({
    ir: renamed,
    options: { query: "fetch", state: "ngrx-signals" },
    links: {
      client: { descriptor: renamedDescriptor, location: { kind: "relative", path: "../client" } },
    },
    artefacts: new Set(["queries", "service"]),
  });

  expect(outcome).toMatchObject({
    status: "refused",
    refusals: [{ code: "names.collision", message: expect.stringContaining("'sendListTasks'") }],
  });
});

// Operations named after the names the module imports or declares, as a feature `with<Op>` would be.
const MODULE_NAME_OPERATIONS: Readonly<Record<string, string>> = {
  getTask: "state",
  getChannel: "methods",
  getDraft: "store",
  archiveTask: "idempotencyKey",
  assignTask: "actionKey",
};

test("`state: ngrx-signals` compiles with operations named after the module's own names", async () => {
  const renamed = {
    ...ir,
    operations: ir.operations.map((operation) => ({
      ...operation,
      id: MODULE_NAME_OPERATIONS[operation.id] ?? operation.id,
    })),
  };
  const renamedDescriptor: ClientDescriptor = {
    ...descriptor,
    operations: Object.fromEntries(
      renamed.operations.map((operation) => [operation.id, { method: operation.id }]),
    ),
  };

  const outcome = await target.generate({
    ir: renamed,
    options: { query: "fetch", state: "ngrx-signals" },
    links: {
      client: { descriptor: renamedDescriptor, location: { kind: "relative", path: "../client" } },
    },
    artefacts: new Set(["queries", "service"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome.refusals));

  rmSync(SIGNALS_PROJECT, { recursive: true, force: true });
  mkdirSync(join(SIGNALS_PROJECT, "front"), { recursive: true });
  mkdirSync(join(SIGNALS_PROJECT, "client"), { recursive: true });
  writeFileSync(join(SIGNALS_PROJECT, "client/index.ts"), STUB_CLIENT);

  for (const file of outcome.files) {
    writeFileSync(join(SIGNALS_PROJECT, "front", file.path), file.contents);
  }

  const program = ts.createProgram([join(SIGNALS_PROJECT, SIGNALS_MODULE)], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  });
  const typeErrors = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

  expect(typeErrors).toEqual([]);
});

test.each(["ngrx", "ngrx-signals"])(
  "`state: %s` without the service artefact is refused by name",
  async (state) => {
    const outcome = await target.generate({
      ir,
      options: { query: "fetch", state },
      links,
      artefacts: new Set(["queries"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: [{ code: "artefact.service.needed" }],
    });
  },
);

test("`state: ngrx` refuses an operation whose action name another operation's outcome takes", async () => {
  const renamed = {
    ...ir,
    operations: ir.operations.map((operation) =>
      operation.id === "getTask" ? { ...operation, id: "listTasksSuccess" } : operation,
    ),
  };
  const renamedDescriptor: ClientDescriptor = {
    ...descriptor,
    operations: Object.fromEntries(
      renamed.operations.map((operation) => [operation.id, { method: operation.id }]),
    ),
  };

  const outcome = await target.generate({
    ir: renamed,
    options: { query: "fetch", state: "ngrx" },
    links: {
      client: { descriptor: renamedDescriptor, location: { kind: "relative", path: "../client" } },
    },
    artefacts: new Set(["queries", "service"]),
  });

  expect(outcome).toMatchObject({
    status: "refused",
    refusals: [
      {
        code: "names.collision",
        message: expect.stringContaining("the action 'listTasksSuccess'"),
      },
    ],
  });
});

test("`state: ngrx` refuses two resources whose action groups take one name", async () => {
  const respelt = {
    ...ir,
    operations: ir.operations.map((operation) =>
      operation.id === "getTask" && operation.resource !== undefined
        ? { ...operation, resource: { ...operation.resource, type: "Tasks" } }
        : operation,
    ),
  };

  const outcome = await target.generate({
    ir: respelt,
    options: { query: "fetch", state: "ngrx" },
    links,
    artefacts: new Set(["queries", "service"]),
  });

  expect(outcome).toMatchObject({
    status: "refused",
    refusals: [
      {
        code: "names.collision",
        message: expect.stringContaining("'TasksActions'"),
        operation: expect.any(String),
      },
    ],
  });
});

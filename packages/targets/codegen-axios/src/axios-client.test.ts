import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedFile } from "@seampact/codegen-core";
import { typesLinks } from "@seampact/codegen-core/node-server/test-support";
import { target as fetchTarget } from "@seampact/codegen-fetch";
import type { ContractIR } from "@seampact/spec/ir";
import axios from "axios";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { target } from "./index.js";

const PROJECT = fileURLToPath(new URL("../.vitest/axios-client/", import.meta.url));
const IR_URL = new URL("../../../../fixtures/golden/reference/tasks.ir.json", import.meta.url);
const BASE = "http://api.test";
const ADAPTER_EXPORT = 'export { fetchOfAxios } from "./axios.js";';

interface GeneratedClient {
  createClient(config: { baseUrl: string; fetch?: typeof fetch }): {
    health(): Promise<Record<string, unknown>>;
  };
  fetchOfAxios(instance: ReturnType<typeof axios.create>): typeof fetch;
}

const ir: ContractIR = JSON.parse(readFileSync(IR_URL, "utf8"));
const server = setupServer();
let generatedFiles: readonly GeneratedFile[];
let generated: GeneratedClient;

async function generateWith(provider: typeof target): Promise<readonly GeneratedFile[]> {
  const outcome = await provider.generate({
    ir,
    options: {},
    links: typesLinks(ir),
    artefacts: new Set(["client"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome));

  return outcome.files;
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: "error" });
  rmSync(PROJECT, { recursive: true, force: true });
  generatedFiles = await generateWith(target);

  for (const file of generatedFiles) {
    mkdirSync(dirname(join(PROJECT, file.path)), { recursive: true });
    writeFileSync(join(PROJECT, file.path), file.contents);
  }

  generated = await import(join(PROJECT, "index.ts"));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("generates the fetch client's files plus the adapter, exported from the index", async () => {
  const fetchPaths = (await generateWith(fetchTarget)).map((file) => file.path);
  const paths = generatedFiles.map((file) => file.path);

  expect(paths.sort()).toEqual([...fetchPaths, "axios.ts"].sort());
  expect(generatedFiles.find((file) => file.path === "index.ts")?.contents).toContain(
    ADAPTER_EXPORT,
  );
});

test("describes the same client link as the fetch client, so the front targets run unchanged", () => {
  expect(target.describe(ir, {})).toEqual(fetchTarget.describe(ir, {}));
});

test("the generated client sends through the app's axios instance, interceptors included", async () => {
  let seenAuthorization: string | null = null;

  server.use(
    http.get(`${BASE}/v1/health`, ({ request }) => {
      seenAuthorization = request.headers.get("authorization");

      return HttpResponse.json({ status: "ok" });
    }),
  );

  const instance = axios.create();

  instance.interceptors.request.use((config) => {
    config.headers.set("authorization", "Bearer app-token");

    return config;
  });

  const client = generated.createClient({
    baseUrl: BASE,
    fetch: generated.fetchOfAxios(instance),
  });

  expect(await client.health()).toMatchObject({ ok: true, status: 200 });
  expect(seenAuthorization).toBe("Bearer app-token");
});

test("an undeclared status is an unexpected result, never an axios throw", async () => {
  server.use(http.get(`${BASE}/v1/health`, () => HttpResponse.text("oops", { status: 500 })));

  const client = generated.createClient({
    baseUrl: BASE,
    fetch: generated.fetchOfAxios(axios.create()),
  });

  expect(await client.health()).toMatchObject({ ok: false, unexpected: true, status: 500 });
});

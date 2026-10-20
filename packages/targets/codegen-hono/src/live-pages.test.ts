import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  copyTestApp,
  emitProject,
  generateReferenceProject,
  projectDirectory,
  type RawReply,
  sendRawRequest,
} from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR, Operation, PagingStyle, Template } from "@seampact/spec/ir";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { target as honoTarget } from "./index.js";

// Boots the generated tasks api under the Laravel and Spring packs, each with one more paging style of its own,
// and reads the pages their styles write: the handler's total, the counted pages and the page URLs.

const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
const GOLDEN = new URL("../../../../fixtures/golden/", import.meta.url);
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 120_000;

const USER = "55555555-5555-4555-8555-555555555555";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const BEARER = { authorization: `Bearer user-${USER}` };
const CHANNELS = [
  { channelId: CHANNEL, name: "General" },
  { channelId: "22222222-2222-4222-8222-222222222222", name: "Random" },
];

interface PagesAppModule {
  readonly scenario: { answers: Record<string, (input: unknown) => unknown> };
  resetScenario(): void;
  startReferenceApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

interface BootedPages {
  app: PagesAppModule;
  send(path: string): Promise<RawReply>;
  close(): Promise<void>;
}

function packIr(pack: string, api: string): ContractIR {
  return JSON.parse(readFileSync(new URL(`${pack}/${api}.ir.json`, GOLDEN), "utf8"));
}

function slot(name: string): Template {
  return { kind: "slot", slot: name, path: [] };
}

function objectOf(members: Record<string, Template>): Template {
  return {
    kind: "object",
    members: Object.entries(members).map(([name, value]) => ({
      name: { kind: "text", text: name },
      value,
    })),
  };
}

function withStyle(ir: ContractIR, operationId: string, style: PagingStyle): ContractIR {
  return {
    ...ir,
    pagings: { ...ir.pagings, [style.id]: style },
    operations: ir.operations.map((operation): Operation => {
      if (operation.id !== operationId || operation.paging === undefined) return operation;

      return { ...operation, paging: { ...operation.paging, style: style.id } };
    }),
  };
}

function requirePaging(ir: ContractIR, styleId: string): PagingStyle {
  const style = ir.pagings[styleId];

  if (style === undefined) throw new Error(`the pack golden lost its paging style '${styleId}'`);

  return style;
}

// The Laravel tasks api, its task list on a style whose body holds the total beside the items.
function laravelIr(api: string): ContractIR {
  const ir = packIr("pack-laravel", api);

  if (api !== "tasks") return ir;

  const laravelPages = requirePaging(ir, "laravelPages");

  return withStyle(ir, "listTasks", {
    ...laravelPages,
    id: "flatPages",
    absent: "omit",
    handlerResult: ["total"],
    response: {
      body: objectOf({ items: slot("items"), total: slot("total"), next: slot("next") }),
      meta: [],
      headers: [],
      links: [],
    },
  });
}

// The Spring tasks api: its task list sorted by nothing (a `pair` sort is not served yet), and its channel list on
// a style that adds the total to a `meta` member of the format's page and writes it in a header.
function springIr(api: string): ContractIR {
  const ir = packIr("pack-spring", api);

  if (api !== "tasks") return ir;

  const springPage = requirePaging(ir, "springPage");
  const unsorted: PagingStyle = {
    ...springPage,
    request: springPage.request.filter((role) => role.role !== "sort"),
  };
  const withMetaPage: ContractIR = {
    ...ir,
    formats: Object.fromEntries(
      Object.entries(ir.formats).map(([id, format]) => [
        id,
        {
          ...format,
          success: {
            ...format.success,
            page: {
              ...format.success.page,
              body: objectOf({ data: slot("items"), meta: slot("meta") }),
            },
          },
        },
      ]),
    ),
    pagings: { ...ir.pagings, springPage: unsorted },
    operations: ir.operations.map((operation): Operation => {
      if (operation.id !== "listTasks" || operation.paging === undefined) return operation;

      return {
        ...operation,
        params: {
          ...operation.params,
          query: operation.params.query.filter((param) => param.name !== "sort"),
        },
        paging: { ...operation.paging, sortKeys: [] },
      };
    }),
  };

  return withStyle(withMetaPage, "listChannels", {
    ...unsorted,
    id: "metaPages",
    handlerResult: ["total"],
    response: {
      meta: [
        { name: "total", value: slot("total") },
        { name: "lastPage", value: slot("totalPages") },
      ],
      headers: [{ name: "X-Total-Count", value: slot("total") }],
      links: [
        { rel: "next", role: "next" },
        { rel: "prev", role: "previous" },
      ],
    },
  });
}

async function bootPages(
  name: string,
  changeIr: (api: string) => ContractIR,
): Promise<BootedPages> {
  const project = projectDirectory(import.meta.url, name);
  const build = join(project, "build");
  const files = await generateReferenceProject(
    project,
    honoTarget,
    { bodyValidation: true },
    (_ir, api) => changeIr(api),
  );

  expect(emitProject(project, files, build)).toEqual([]);

  const app: PagesAppModule = await import(copyTestApp(build, APP_SOURCE));
  const server = await app.startReferenceApp();

  return {
    app,
    send: (path) => sendRawRequest(server, "GET", path, { headers: BEARER }),
    close: () => server.close(),
  };
}

function answerPage(booted: BootedPages, operationId: string, total: number): void {
  booted.app.scenario.answers[operationId] = () => ({
    status: 200,
    body: { items: CHANNELS, total },
  });
}

describe("pages under the Laravel pack", () => {
  let laravel: BootedPages;

  beforeAll(async () => {
    laravel = await bootPages("live-pages-laravel", laravelIr);
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await laravel?.close();
  });

  beforeEach(() => {
    laravel.app.resetScenario();
  });

  test("a length-aware page counts its pages and links them, a missing link written null", async () => {
    answerPage(laravel, "listChannels", 5);

    const reply = await laravel.send("/v1/channels?page=2&per_page=2");

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({
      data: CHANNELS,
      links: {
        first: "/v1/channels?per_page=2&page=1",
        last: "/v1/channels?per_page=2&page=3",
        prev: "/v1/channels?per_page=2&page=1",
        next: "/v1/channels?per_page=2&page=3",
      },
      meta: {
        current_page: 2,
        from: 3,
        last_page: 3,
        path: "/v1/channels",
        per_page: 2,
        to: 4,
        total: 5,
      },
    });
  });

  test("the last page has no next link, written null as the style's absent says", async () => {
    answerPage(laravel, "listChannels", 4);

    const reply = await laravel.send("/v1/channels?page=2&per_page=2");

    expect(JSON.parse(reply.text).links.next).toBeNull();
  });

  test("an item is answered in the format's data envelope", async () => {
    const reply = await laravel.send(`/v1/channels/${CHANNEL}`);

    expect(JSON.parse(reply.text)).toEqual({ data: { channelId: CHANNEL, name: "General" } });
  });

  test("a style's flat body writes the total beside the items", async () => {
    answerPage(laravel, "listTasks", 3);

    const reply = await laravel.send(`/v1/channels/${CHANNEL}/tasks?per_page=2`);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toMatchObject({
      total: 3,
      next: `/v1/channels/${CHANNEL}/tasks?per_page=2&page=2`,
    });
  });
});

describe("pages under the Spring pack", () => {
  let spring: BootedPages;

  beforeAll(async () => {
    spring = await bootPages("live-pages-spring", springIr);
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await spring?.close();
  });

  beforeEach(() => {
    spring.app.resetScenario();
  });

  test("a Spring page counts its pages from zero", async () => {
    answerPage(spring, "listTasks", 5);

    const reply = await spring.send(`/v1/channels/${CHANNEL}/tasks?page=1&size=2`);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toMatchObject({
      page: { size: 2, number: 1, totalElements: 5, totalPages: 3 },
    });
  });

  test("a style's meta members join the format's meta, and its header and links are written", async () => {
    answerPage(spring, "listChannels", 5);

    const reply = await spring.send("/v1/channels?page=1&size=2");

    expect(JSON.parse(reply.text)).toEqual({ data: CHANNELS, meta: { total: 5, lastPage: 3 } });
    expect(reply.headers["x-total-count"]).toBe("5");
    expect(reply.headers.link).toBe(
      '</v1/channels?size=2&page=2>; rel="next", </v1/channels?size=2&page=0>; rel="prev"',
    );
  });
});

import {
  answerPage,
  type BootedPages,
  bootPages,
  laravelOffsetChannels,
  objectOf,
  PAGE_CHANNEL as CHANNEL,
  PAGE_CHANNELS as CHANNELS,
  packIr,
  projectDirectory,
  queryRole,
  referenceLinks,
  requirePaging,
  slot,
  withRequestStyle,
  withStyle,
} from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR, Operation, PagingStyle } from "@seampact/spec/ir";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { target as honoTarget } from "./index.js";

// Boots the generated tasks api under the Laravel and Spring packs, each with one more paging style of its own,
// and on offset, after/before cursor and since styles, and reads the pages their styles write: the handler's
// facts, the counted pages and the page URLs.

const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
// Generating and compiling both apis outruns vitest's default 10 s hook limit on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 120_000;

function pagesProject(name: string) {
  return { testFileUrl: import.meta.url, name, target: honoTarget, appSource: APP_SOURCE };
}

// The Laravel tasks api, its task list on a since style whose own body holds the next since token's URL.
function laravelIr(api: string): ContractIR {
  const ir = packIr("pack-laravel", api);

  if (api !== "tasks") return ir;

  return withRequestStyle(ir, "listTasks", {
    ...requirePaging(ir, "laravelPages"),
    id: "sincePages",
    position: "since",
    absent: "omit",
    request: [queryRole("since", "since")],
    handlerResult: ["nextSince", "complete"],
    response: {
      body: objectOf({ items: slot("items"), complete: slot("complete"), next: slot("next") }),
      meta: [],
      headers: [],
      links: [],
    },
  });
}

// The Laravel tasks api, its channel list on an offset style and its task list on an after/before cursor style.
function positionsIr(api: string): ContractIR {
  const withOffset = laravelOffsetChannels(api);

  if (api !== "tasks") return withOffset;

  return withRequestStyle(withOffset, "listTasks", {
    ...requirePaging(withOffset, "laravelPages"),
    id: "afterBeforePages",
    position: "cursor",
    absent: "omit",
    request: [
      queryRole("after", "after"),
      queryRole("before", "before"),
      queryRole("limit", "limit"),
    ],
    handlerResult: ["nextCursor", "previousCursor"],
    response: {
      body: objectOf({ items: slot("items"), next: slot("next"), previous: slot("previous") }),
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

describe("pages under the Laravel pack", () => {
  let laravel: BootedPages;

  beforeAll(async () => {
    laravel = await bootPages(pagesProject("live-pages-laravel"), laravelIr);
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await laravel?.close();
  });

  beforeEach(() => {
    laravel.app.resetScenario();
  });

  test("a length-aware page counts its pages and links them, a missing link written null", async () => {
    answerPage(laravel, "listChannels", { total: 5 });

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
    answerPage(laravel, "listChannels", { total: 4 });

    const reply = await laravel.send("/v1/channels?page=2&per_page=2");

    expect(JSON.parse(reply.text).links.next).toBeNull();
  });

  test("an item is answered in the format's data envelope", async () => {
    const reply = await laravel.send(`/v1/channels/${CHANNEL}`);

    expect(JSON.parse(reply.text)).toEqual({ data: { channelId: CHANNEL, name: "General" } });
  });

  test("a format's page headers and a page header written from an object are refused by name, once", async () => {
    const ir = laravelIr("tasks");
    const [format] = Object.values(ir.formats);
    const laravelPages = requirePaging(ir, "laravelPages");

    if (format === undefined) throw new Error("the Laravel golden lost its format");

    format.success.page.headers = [{ name: "X-Page", value: slot("status") }];
    laravelPages.response.headers = [{ name: "X-Meta", value: slot("meta") }];

    const outcome = await honoTarget.generate({
      ir,
      options: {},
      links: await referenceLinks(projectDirectory(import.meta.url, "live-pages-laravel"), "tasks"),
      artefacts: new Set(["boundary"]),
    });
    const codes =
      outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];

    expect(codes.filter((code) => code === "format.success.headers.unsupported")).toHaveLength(1);
    expect(codes.filter((code) => code === "paging.response.header.unsupported")).toHaveLength(1);
  });

  test("a since style's own body links the next token and says whether the list is complete", async () => {
    answerPage(laravel, "listTasks", { nextSince: "t2", complete: false });

    const reply = await laravel.send(`/v1/channels/${CHANNEL}/tasks?since=t1`);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({
      items: expect.any(Array),
      complete: false,
      next: `/v1/channels/${CHANNEL}/tasks?since=t2`,
    });
  });
});

describe("pages on offset and after/before cursor positions", () => {
  let positions: BootedPages;

  beforeAll(async () => {
    positions = await bootPages(pagesProject("live-pages-positions"), positionsIr);
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await positions?.close();
  });

  beforeEach(() => {
    positions.app.resetScenario();
  });

  test("an offset off a page start links the next page one limit further", async () => {
    answerPage(positions, "listChannels", { total: 30 });

    const reply = await positions.send("/v1/channels?offset=5&limit=10");

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({
      items: CHANNELS,
      total: 30,
      offset: 5,
      from: 6,
      to: 7,
      next: "/v1/channels?limit=10&offset=15",
      previous: "/v1/channels?limit=10&offset=0",
    });
  });

  test("an offset whose page reaches the total has no next link", async () => {
    answerPage(positions, "listChannels", { total: 25 });

    const reply = await positions.send("/v1/channels?offset=15&limit=10");

    expect(JSON.parse(reply.text).next).toBeUndefined();
    expect(reply.headers.link).toBe('</v1/channels?limit=10&offset=5>; rel="prev"');
  });

  test("a total that is not a record count is a 500", async () => {
    answerPage(positions, "listChannels", { total: 2.5 });

    const reply = await positions.send("/v1/channels?offset=0&limit=10");

    expect(reply.status).toBe(500);
  });

  test("an after/before cursor page links the handler's cursors in their own params", async () => {
    answerPage(positions, "listTasks", { nextCursor: "c3", previousCursor: "c2" });

    const reply = await positions.send(`/v1/channels/${CHANNEL}/tasks?after=c1&limit=2`);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({
      items: expect.any(Array),
      next: `/v1/channels/${CHANNEL}/tasks?limit=2&after=c3`,
      previous: `/v1/channels/${CHANNEL}/tasks?limit=2&before=c2`,
    });
  });

  test("the last cursor page has no next link", async () => {
    answerPage(positions, "listTasks", { previousCursor: "c2" });

    const reply = await positions.send(`/v1/channels/${CHANNEL}/tasks?after=c1&limit=2`);

    expect(JSON.parse(reply.text).next).toBeUndefined();
  });
});

describe("pages under the Spring pack", () => {
  let spring: BootedPages;

  beforeAll(async () => {
    spring = await bootPages(pagesProject("live-pages-spring"), springIr);
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(async () => {
    await spring?.close();
  });

  beforeEach(() => {
    spring.app.resetScenario();
  });

  test("a Spring page counts its pages from zero", async () => {
    answerPage(spring, "listTasks", { total: 5 });

    const reply = await spring.send(`/v1/channels/${CHANNEL}/tasks?page=1&size=2`);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toMatchObject({
      page: { size: 2, number: 1, totalElements: 5, totalPages: 3 },
    });
  });

  test("a style's meta members join the format's meta, and its header and links are written", async () => {
    answerPage(spring, "listChannels", { total: 5 });

    const reply = await spring.send("/v1/channels?page=1&size=2");

    expect(JSON.parse(reply.text)).toEqual({ data: CHANNELS, meta: { total: 5, lastPage: 3 } });
    expect(reply.headers["x-total-count"]).toBe("5");
    expect(reply.headers.link).toBe(
      '</v1/channels?size=2&page=2>; rel="next", </v1/channels?size=2&page=0>; rel="prev"',
    );
  });
});
